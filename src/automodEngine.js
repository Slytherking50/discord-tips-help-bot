// automoderacion avanzada: estafas, spam, raids, escalado de castigos y el juez de IA. La logica de decidir esta en
// guard.js (pura); aca se junta con Discord (borrar, silenciar, avisar), la base (casos) y la IA.
// Regla de oro: un fallo de la IA o de un permiso NUNCA castiga a nadie; el staff (Gestionar mensajes o mas) nunca se toca.

const { PermissionFlagsBits } = require('discord.js');
const guard = require('./guard');

const NOTICE_MS = 6000;
const JUDGE_WAIT_MS = 6000;
const JUDGE_QUEUE_MAX = 8;
const MAX_DELETIONS = 12;
const MAX_TIMEOUT_MINUTES = 40320;
const STAFF_PERMISSIONS = [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers];
const DAY_MS = 86400000;

const KIND_LABELS = {
  scam: 'estafa o phishing',
  compromised: 'posible cuenta comprometida (el mismo link en varios canales)',
  flood: 'spam: demasiados mensajes seguidos',
  duplicate: 'spam: mensaje repetido',
  caps: 'mensaje en mayúsculas',
  emojis: 'demasiados emojis',
};

// los links del mensaje con "http" cambiado, para que nadie los abra por error desde el canal de logs
function defang(text) {
  return String(text || '').replace(/https?:\/\//gi, (match) => match.replace('tt', 'xx')).replace(/`/g, "'").slice(0, 400);
}

function minutes(value, fallback) {
  const number = Math.floor(Number(value));
  return Math.min(MAX_TIMEOUT_MINUTES, Math.max(1, Number.isFinite(number) ? number : fallback));
}

function create({ client, db, aiHelper, logging, trackAiUsage = () => {} }) {
  const spam = new guard.SpamTracker();
  const raid = new guard.RaidTracker();
  let judging = 0;
  const waiting = [];

  function aiReady(config) {
    return Boolean(config?.ai?.enabled && aiHelper.isConfigured(config));
  }

  function isExempt(message, member, settings) {
    if (!member) return false;
    const channel = message.channel;
    if ((settings.exemptChannelIds || []).some((id) => id === channel.id || id === channel.parentId)) return true;
    if (STAFF_PERMISSIONS.some((permission) => member.permissions?.has(permission))) return true;
    return (settings.exemptRoleIds || []).some((id) => member.roles?.cache?.has(id));
  }

  // consulta al juez de IA de a una, con una cola corta: en una oleada de mensajes se salta el resto antes que atrasar todo
  function judge(config, message, { rules, focus }) {
    if (judging >= 1 && waiting.length >= JUDGE_QUEUE_MAX) return Promise.resolve(null);
    const task = new Promise((resolve) => {
      const run = async () => {
        judging += 1;
        try {
          const verdict = await aiHelper.judgeMessage(client, config, message.content, { serverName: message.guild.name, rules, focus });
          trackAiUsage(message.guild.id, Boolean(verdict));
          resolve(verdict);
        } catch {
          resolve(null);
        } finally {
          judging -= 1;
          const next = waiting.shift();
          if (next) next();
        }
      };
      if (judging >= 1) waiting.push(run);
      else run();
    });
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), JUDGE_WAIT_MS);
    });
    return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
  }

  async function deleteTracked(guild, entries, exceptMessageId) {
    for (const entry of entries.filter((item) => item.messageId !== exceptMessageId).slice(0, MAX_DELETIONS)) {
      const channel = guild.channels.cache.get(entry.channelId);
      await channel?.messages?.delete?.(entry.messageId).catch(() => {});
    }
  }

  // aplica el escalon del castigo y deja un caso; devuelve el texto de lo que hizo (o null)
  async function applyStep(guild, member, step, count) {
    if (!member || !step) return null;
    const reason = `Escalado automático: ${count} advertencias`;
    try {
      if (step.action === 'timeout' && member.moderatable) {
        const length = minutes(step.minutes, 60);
        await member.timeout(length * 60000, reason);
        await db.addCase({ guildId: guild.id, type: 'mute', userId: member.id, reason, auto: true, details: { minutes: length } }).catch(() => {});
        return `silenciado ${length} min`;
      }
      if (step.action === 'kick' && member.kickable) {
        await member.kick(reason);
        await db.addCase({ guildId: guild.id, type: 'kick', userId: member.id, reason, auto: true }).catch(() => {});
        return 'expulsado';
      }
      if (step.action === 'ban' && member.bannable) {
        await member.ban({ reason });
        await db.addCase({ guildId: guild.id, type: 'ban', userId: member.id, reason, auto: true }).catch(() => {});
        return 'baneado';
      }
    } catch (err) {
      console.warn('No se pudo aplicar el castigo automático:', err.message);
    }
    return null;
  }

  // cuenta las advertencias de la ventana de tiempo y aplica el castigo que toque. { count, action } (count null = escalado apagado)
  async function escalate(guild, member, config) {
    const settings = config?.automod?.strikes;
    if (!settings?.enabled || !member) return { count: null, action: null };
    const since = new Date(Date.now() - Math.max(1, Number(settings.windowDays) || 30) * DAY_MS);
    const count = await db.countStrikes(guild.id, member.id, since);
    const action = await applyStep(guild, member, guard.pickLadderStep(settings.ladder, count), count);
    return { count, action };
  }

  // una falta de la automoderacion: caso + advertencia que cuenta + castigo si toca. Devuelve { entry, count, action }
  async function registerStrike(message, config, reason, details = {}) {
    const member = message.member || (await message.guild.members.fetch(message.author.id).catch(() => null));
    const entry = await db.addCase({ guildId: message.guild.id, type: 'automod', userId: message.author.id, reason, auto: true, details: { channelId: message.channel.id, ...details } }).catch(() => null);
    const { count, action } = await escalate(message.guild, member, config).catch(() => ({ count: null, action: null }));
    return { entry, count, action, member };
  }

  async function notifyUser(message, kind, reason, count) {
    const compromised = kind === 'scam' || kind === 'compromised';
    const text = compromised
      ? `🛡️ En **${message.guild.name}** se borró un mensaje tuyo que parecía una estafa. Si no lo escribiste tú, tu cuenta puede estar comprometida: cambia tu contraseña y activa la verificación en dos pasos.`
      : `⚠️ En **${message.guild.name}** se borró un mensaje tuyo: ${reason}.${count ? ` Llevas ${count} advertencia(s) en este periodo.` : ''}`;
    await message.author.send(text).catch(() => {});
  }

  // borra, deja el caso, castiga si toca, avisa en el canal y manda el log al staff
  async function enforce(message, config, { kind, reason, entries = [], strike = true, timeoutMinutes = 0, signals = [], silent = false }) {
    const settings = config.automod;
    await message.delete().catch(() => {});
    await deleteTracked(message.guild, entries, message.id);
    spam.forget(message.guild.id, message.author.id);

    let result = { entry: null, count: null, action: null, member: message.member };
    if (strike) {
      result = await registerStrike(message, config, reason, { kind, signals });
    } else {
      result.entry = await db.addCase({ guildId: message.guild.id, type: 'automod', userId: message.author.id, reason, auto: true, details: { kind, channelId: message.channel.id } }).catch(() => null);
    }

    let timedOut = null;
    if (timeoutMinutes && result.member?.moderatable) {
      const length = minutes(timeoutMinutes, 60);
      try {
        await result.member.timeout(length * 60000, `Automoderación: ${reason}`);
        timedOut = `silenciado ${length} min`;
        await db.addCase({ guildId: message.guild.id, type: 'mute', userId: message.author.id, reason: `Automoderación: ${reason}`, auto: true, details: { minutes: length } }).catch(() => {});
      } catch (err) {
        console.warn('No se pudo silenciar a quien mandó la estafa:', err.message);
      }
    }

    if (!silent) {
      const warning = await message.channel.send({ content: `🛡️ <@${message.author.id}>, se borró tu mensaje (${reason}).`, allowedMentions: { users: [message.author.id] } }).catch(() => null);
      if (warning) setTimeout(() => warning.delete().catch(() => {}), NOTICE_MS);
    }
    notifyUser(message, kind, reason, result.count).catch(() => {});

    const actions = [timedOut, result.action].filter(Boolean).join(' y ');
    await logging
      .sendLog(client, config, {
        type: kind === 'scam' || kind === 'compromised' ? 'error' : 'warning',
        title: `🛡️ Automoderación: ${KIND_LABELS[kind] || reason}`,
        description: `\`\`\`${defang(message.content) || '(sin texto)'}\`\`\``,
        fields: [
          { name: 'Usuario', value: `<@${message.author.id}> (${message.author.username})`, inline: true },
          { name: 'Canal', value: `<#${message.channel.id}>`, inline: true },
          ...(result.entry ? [{ name: 'Caso', value: `#${result.entry.number}`, inline: true }] : []),
          ...(result.count ? [{ name: 'Advertencias', value: String(result.count), inline: true }] : []),
          ...(actions ? [{ name: 'Acción', value: actions, inline: true }] : []),
          ...(signals.length ? [{ name: 'Señales', value: signals.slice(0, 5).join('\n').slice(0, 900) }] : []),
        ],
      })
      .catch(() => {});
    return true;
  }

  async function checkScam(message, config, entries) {
    const shield = config.automod.scamShield;
    const member = message.member;
    const verdict = guard.scamScore(message.content, {
      accountAgeDays: (Date.now() - message.author.createdTimestamp) / DAY_MS,
      memberAgeDays: member?.joinedTimestamp ? (Date.now() - member.joinedTimestamp) / DAY_MS : undefined,
    });
    const timeoutMinutes = shield.action === 'timeout' ? minutes(shield.timeoutMinutes, 60) : 0;

    // el mismo link en varios canales casi a la vez: cuenta robada repartiendo estafas
    const cross = guard.detectCrossChannel(entries);
    if (cross && verdict.urls.length) {
      return enforce(message, config, { kind: 'compromised', reason: KIND_LABELS.compromised, entries: cross.entries, timeoutMinutes, signals: verdict.reasons });
    }
    if (verdict.level === 'scam') {
      return enforce(message, config, { kind: 'scam', reason: KIND_LABELS.scam, timeoutMinutes, signals: verdict.reasons });
    }
    if (verdict.level === 'suspect' && shield.aiJudge && aiReady(config)) {
      const decision = await judge(config, message, {
        rules: config.automod.aiRules?.rules,
        focus: `Un filtro automático marcó este mensaje como posible estafa o phishing por: ${verdict.reasons.join('; ')}. Decide si de verdad lo es (regla 3).`,
      });
      if (decision?.violation && decision.confidence >= 0.8) {
        return enforce(message, config, { kind: 'scam', reason: KIND_LABELS.scam, timeoutMinutes, signals: [...verdict.reasons, `IA: ${decision.reason} (${Math.round(decision.confidence * 100)}%)`] });
      }
    }
    return false;
  }

  async function checkSpam(message, config, entries) {
    const settings = config.automod.antiSpam;
    const flood = guard.detectFlood(entries, settings);
    if (flood) return enforce(message, config, { kind: 'flood', reason: KIND_LABELS.flood, entries: flood.entries });

    const duplicate = guard.detectDuplicates(entries, settings);
    if (duplicate) return enforce(message, config, { kind: 'duplicate', reason: KIND_LABELS.duplicate, entries: duplicate.entries });

    if (settings.maxCapsPercent > 0 && guard.capsRatio(message.content) * 100 >= settings.maxCapsPercent) {
      return enforce(message, config, { kind: 'caps', reason: KIND_LABELS.caps, strike: false });
    }
    if (settings.maxEmojis > 0 && guard.countEmojis(message.content) > settings.maxEmojis) {
      return enforce(message, config, { kind: 'emojis', reason: KIND_LABELS.emojis, strike: false });
    }
    return false;
  }

  async function checkRules(message, config) {
    const settings = config.automod.aiRules;
    if (!settings?.enabled || !aiReady(config) || !guard.needsJudge(message.content)) return false;

    const decision = await judge(config, message, {
      rules: settings.rules,
      focus: 'Este mensaje tiene lenguaje fuerte. Decide si es acoso, una amenaza u otra falta real, o charla normal entre miembros.',
    });
    const minConfidence = Math.min(0.99, Math.max(0.5, Number(settings.minConfidence) || 0.85));
    if (!decision?.violation || decision.confidence < minConfidence) return false;

    const reason = `regla ${decision.rule ?? '?'}: ${decision.reason || 'infracción'}`;
    if (settings.action === 'delete') {
      return enforce(message, config, { kind: 'ai', reason, signals: [`IA (${Math.round(decision.confidence * 100)}% de seguridad)`] });
    }
    // "avisar al staff": no se borra nada, una persona decide
    await logging
      .sendLog(client, config, {
        type: 'warning',
        title: '🤖 Posible infracción (la decide el staff)',
        description: `\`\`\`${defang(message.content)}\`\`\``,
        fields: [
          { name: 'Usuario', value: `<@${message.author.id}> (${message.author.username})`, inline: true },
          { name: 'Canal', value: `<#${message.channel.id}>`, inline: true },
          { name: 'Motivo de la IA', value: `${reason} (${Math.round(decision.confidence * 100)}% de seguridad)` },
          { name: 'Mensaje', value: `[Ir al mensaje](${message.url})` },
        ],
      })
      .catch(() => {});
    return false;
  }

  // Devuelve true si el mensaje se borro
  async function check(message, config) {
    const settings = config?.automod;
    if (!settings?.enabled || !message.guild || message.author?.bot) return false;
    const antiSpamOn = settings.antiSpam?.enabled;
    const scamOn = settings.scamShield?.enabled;
    const rulesOn = settings.aiRules?.enabled;
    if (!antiSpamOn && !scamOn && !rulesOn) return false;

    const member = message.member || (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (isExempt(message, member, settings)) return false;
    if (!message.member && member) message.member = member;

    const entries = spam.record(message.guild.id, message.author.id, { channelId: message.channel.id, messageId: message.id, text: message.content });
    if (scamOn && (await checkScam(message, config, entries))) return true;
    if (antiSpamOn && (await checkSpam(message, config, entries))) return true;
    if (rulesOn && (await checkRules(message, config))) return true;
    return false;
  }

  // alguien entro al server: cuenta ingresos y avisa (y, si se eligio, silencia) cuando entran de golpe
  async function onMemberJoin(member, config) {
    const settings = config?.automod?.raid;
    if (!config?.automod?.enabled || !settings?.enabled || member.user.bot) return null;

    const result = raid.record(member.guild.id, member.user, settings);
    const length = minutes(settings.timeoutMinutes, 10);
    const silence = async (target) => {
      if (settings.action === 'timeout' && target?.moderatable) await target.timeout(length * 60000, 'Posible raid: ingreso masivo').catch(() => {});
    };

    if (result.triggered) {
      for (const id of result.memberIds) await silence(member.guild.members.cache.get(id));
      await db.addCase({ guildId: member.guild.id, type: 'raid', reason: `${result.joins} cuentas entraron en ${settings.perSeconds} s`, auto: true, details: { young: result.young } }).catch(() => {});
      await logging
        .sendLog(client, config, {
          type: 'error',
          title: '🚨 Posible raid',
          description: `Entraron **${result.joins} cuentas en ${settings.perSeconds} segundos**${result.young ? `, ${result.young} de ellas creadas hace menos de 7 días` : ''}.${settings.action === 'timeout' ? ` Las silencié ${length} min mientras el staff revisa.` : ' No tomé ninguna acción: revisa los ingresos recientes.'}`,
          fields: [{ name: 'Qué hacer', value: 'Si es un ataque, activa el nivel de verificación más alto del server (Ajustes → Seguridad) y banea a las cuentas nuevas. Si es gente de verdad (un video, un anuncio), no hace falta nada.' }],
        })
        .catch(() => {});
    } else if (result.inRaid) {
      await silence(member);
    }
    return result;
  }

  return { check, onMemberJoin, escalate, registerStrike, isExempt };
}

module.exports = { create, defang, KIND_LABELS };
