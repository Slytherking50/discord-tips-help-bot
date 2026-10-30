const aiHelper = require('./aiHelper');
const errorReporter = require('./errorReporter');
const { findImageAttachment } = require('./imageAttachments');

// evita pedirle feedback a la IA mas de una vez para el mismo mensaje si
// varias personas reaccionan con el emoji configurado — vive en memoria
// (se pierde si el proceso reinicia, que en el peor caso solo permite un
// feedback duplicado, no rompe nada)
const alreadyGivenFeedback = new Set();
// si el feedback falla, el mensaje no queda marcado para siempre: se puede volver a pedir
// pasado un rato (no antes, para no responder el mismo error a cada reaccion)
const FAILED_FEEDBACK_RETRY_MS = 60 * 1000;

function allowRetryLater(messageId) {
  const timer = setTimeout(() => alreadyGivenFeedback.delete(messageId), FAILED_FEEDBACK_RETRY_MS);
  timer.unref?.();
}

async function handleRenderFeedbackReaction(reaction, user, config) {
  const settings = config?.ai?.renderFeedback;
  if (!settings?.enabled || !settings.channelIds?.length) return;
  if (user.bot) return;

  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return;
    }
  }
  if (reaction.emoji.name !== settings.emoji) return;

  const message = reaction.message;
  if (message.partial) {
    try {
      await message.fetch();
    } catch {
      return;
    }
  }
  if (!settings.channelIds.includes(message.channel.id)) return;
  if (alreadyGivenFeedback.has(message.id)) return;

  const imageAttachment = findImageAttachment(message);
  if (!imageAttachment) return;

  if (!aiHelper.isConfigured(config)) {
    alreadyGivenFeedback.add(message.id);
    await message.reply('⚠️ La IA no está configurada en este server, así que no puedo dar feedback. Avísale a un admin (dashboard → IA).');
    return;
  }

  alreadyGivenFeedback.add(message.id);

  try {
    const result = await aiHelper.critiqueRenderImage(message.client, config, imageAttachment.url, {
      botName: config?.branding?.nickname || message.guild.members.me?.displayName,
      tone: config?.ai?.tone,
      customPersonality: config?.ai?.customPersonality,
    });

    if (result.ok) {
      // el texto lo escribe la IA a partir de una imagen ajena: nunca debe poder mencionar a nadie
      await message.reply({ content: `🔍 **Feedback del render:**\n${result.text}`.slice(0, 1900), allowedMentions: { parse: [], repliedUser: false } });
      return;
    }

    allowRetryLater(message.id);
    if (result.reason === 'no-vision-access') {
      await message.reply('⚠️ Ahora mismo no puedo ver imágenes: ningún modelo con visión responde en la cuenta de IA de este bot. Esto lo tiene que revisar el dueño del bot.');
    } else if (result.reason === 'bad-image') {
      await message.reply('⚠️ No pude abrir esa imagen (puede pesar demasiado o tener un formato raro). Súbela de nuevo como PNG o JPG.');
    } else {
      await message.reply('🤖 No pude generar el feedback ahora, prueba de nuevo en un rato.');
    }
  } catch (err) {
    allowRetryLater(message.id);
    console.error('Error dando feedback de render:', err);
    await errorReporter.reportError(message.client, config, 'renderFeedback.handleRenderFeedbackReaction', err);
  }
}

module.exports = { handleRenderFeedbackReaction, findImageAttachment };
