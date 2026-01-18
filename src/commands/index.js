import { noodleCommand } from "./noodle.js";

export const commands = [noodleCommand];
export const commandMap = new Map(commands.map(c => [c.data.name, c]));
