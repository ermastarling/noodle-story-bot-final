import { noodleCommand } from "./noodle.js";
import { noodleSocialCommand } from "./noodleSocial.js";
import { noodleStaffCommand } from "./noodleStaff.js";
import { noodleUpgradesCommand } from "./noodleUpgrades.js";
import { noodleQuestsCommand } from "./noodleQuests.js";

export const commands = [noodleCommand, noodleSocialCommand, noodleStaffCommand, noodleUpgradesCommand, noodleQuestsCommand];
export const commandMap = new Map(commands.map(c => [c.data.name, c]));
