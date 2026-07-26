import test from "node:test";
import assert from "node:assert/strict";

import { getDailyRewardReminderCronExpr } from "../src/jobs/dailyRewardReminders.js";

test("Daily reminder scheduler uses the approved once-daily UTC cron by default", () => {
  assert.equal(getDailyRewardReminderCronExpr({}), "15 0 * * *");
});

test("Daily reminder scheduler honors an explicit override", () => {
  assert.equal(getDailyRewardReminderCronExpr({ NOODLE_DAILY_REMINDER_CRON: "5 9 * * *" }), "5 9 * * *");
});