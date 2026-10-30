const announceCommand = require('./announceCommand');
const ticketCommand = require('./ticketCommand');
const levelCommands = require('./levelCommands');
const moderationCommands = require('./moderationCommands');
const housesCommand = require('./housesCommand');
const customCommands = require('./customCommands');
const economyCommands = require('./economyCommands');
const casinoCommands = require('./casinoCommands');
const marriageCommands = require('./marriageCommands');
const petCommands = require('./petCommands');
const triviaCommand = require('./triviaCommand');
const memeCommand = require('./memeCommand');
const debugCommand = require('./debugCommand');
const giveawayCommand = require('./giveawayCommand');
const pollCommand = require('./pollCommand');
const afkCommand = require('./afkCommand');
const birthdayCommand = require('./birthdayCommand');
const inviteCommand = require('./inviteCommand');
const sayCommand = require('./sayCommand');
const aiCommands = require('./aiCommands');
const serverInfoCommand = require('./serverInfoCommand');
const portfolioCommand = require('./portfolioCommand');
const skillsCommand = require('./skillsCommand');
const contestCommand = require('./contestCommand');
const socialCommands = require('./socialCommands');
const miniGames = require('./miniGames');

const STATIC_DEFINITIONS = [
  announceCommand.definition,
  ticketCommand.definition,
  levelCommands.nivelDefinition,
  levelCommands.rankingDefinition,
  moderationCommands.banDefinition,
  moderationCommands.kickDefinition,
  moderationCommands.muteDefinition,
  moderationCommands.unmuteDefinition,
  moderationCommands.warnDefinition,
  moderationCommands.warningsDefinition,
  housesCommand.definition,
  economyCommands.definition,
  casinoCommands.definition,
  marriageCommands.casarDefinition,
  marriageCommands.divorciarDefinition,
  marriageCommands.parejaDefinition,
  petCommands.definition,
  triviaCommand.definition,
  memeCommand.definition,
  debugCommand.definition,
  giveawayCommand.definition,
  pollCommand.definition,
  afkCommand.definition,
  birthdayCommand.definition,
  inviteCommand.definition,
  sayCommand.decirDefinition,
  sayCommand.programarDefinition,
  aiCommands.preguntarDefinition,
  aiCommands.explicarDefinition,
  serverInfoCommand.definition,
  portfolioCommand.definition,
  skillsCommand.definition,
  contestCommand.definition,
  socialCommands.accionDefinition,
  socialCommands.repDefinition,
  socialCommands.robarDefinition,
  socialCommands.crimenDefinition,
  socialCommands.shipDefinition,
  socialCommands.eightBallDefinition,
  socialCommands.avatarDefinition,
  socialCommands.mezclarDefinition,
  miniGames.definition,
].map((def) => def.toJSON());

async function registerGuildCommands(guild, config) {
  await customCommands.registerGuildCommands(guild, config, STATIC_DEFINITIONS);
}

module.exports = { STATIC_DEFINITIONS, registerGuildCommands };
