const { errorEmbed } = require('./embedStyle');

// las rutas de archivo del hosting (/opt/render/project/src/...) no aportan
// nada al leer el error: se dejan solo las primeras lineas con "src/archivo:linea"
function summarizeStack(error) {
  const lines = String(error?.stack || '').split('\n').slice(1);
  return lines
    .filter((line) => !line.includes('node_modules') && !line.includes('node:internal'))
    .slice(0, 4)
    .map((line) => line.replace(/\(?\/?(?:[\w.-]+\/)*?src\/(?:src\/)?/, '(src/').trim())
    .join('\n');
}

async function reportError(client, config, context, error) {
  if (!config?.debug?.enabled || !config.debug.errorChannelId) return;

  try {
    const channel = await client.channels.fetch(config.debug.errorChannelId);
    if (!channel || !channel.isTextBased()) return;

    const message = String(error?.message || error).slice(0, 900);
    const stack = summarizeStack(error);
    const embed = errorEmbed(config, {
      title: 'Error interno',
      fields: [
        { name: 'Dónde', value: `\`${String(context).slice(0, 200)}\``, inline: true },
        { name: 'Tipo', value: `\`${error?.name || 'Error'}${error?.code ? ` · ${error.code}` : ''}\``, inline: true },
        { name: 'Mensaje', value: `\`\`\`${message}\`\`\`` },
        ...(stack ? [{ name: 'Origen en el código', value: `\`\`\`${stack.slice(0, 900)}\`\`\`` }] : []),
      ],
    });

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('No se pudo reportar el error al canal de debug:', err);
  }
}

module.exports = { reportError };
