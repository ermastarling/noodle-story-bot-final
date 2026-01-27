import { noodleCommand } from "./noodle.js";
import { noodleSocialCommand } from "./noodleSocial.js";

export const commands = [noodleCommand, noodleSocialCommand];
export const commandMap = new Map(commands.map(c => [c.data.name, c]));
