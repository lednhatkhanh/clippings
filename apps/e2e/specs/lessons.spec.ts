import type { LessonsService } from "@clippings/db";
import type { LessonQuiz } from "@clippings/shared";

import { expect, test } from "../support/fixtures.ts";

const TOPIC = "How sourdough starters work";
const QUIZ: LessonQuiz = {
  question: "What feeds the yeast in a starter?",
  choices: ["Salt", "Flour", "Butter"],
  answerIndex: 1,
  explanation: "The flour's starch breaks down into sugars the yeast eats.",
};

/** Writes the user's lesson for `day`, drawn on `sourceIds`. */
async function writeLesson(
  lessons: LessonsService,
  userId: string,
  day: string,
  sourceIds: string[],
) {
  const claim = await lessons.claimLesson(userId, day);
  if (claim.status !== "claimed") throw new Error(`Couldn't claim the lesson for ${day}`);
  const done = await lessons.completeLesson(userId, claim.lessonId, {
    topic: TOPIC,
    tagId: null,
    body: "## Wild yeast\n\nA starter is flour and water left to ferment.",
    quiz: QUIZ,
    recap: "Last time we met **hydration**.",
    sourceIds,
  });
  if (!done) throw new Error("Couldn't complete the lesson");
  return claim.lessonId;
}

test.describe("lessons", () => {
  test("lists a written lesson and says why another was skipped", async ({
    page,
    user,
    lessons,
  }) => {
    await writeLesson(lessons, user.id, "2026-11-04", []);
    const skipped = await lessons.claimLesson(user.id, "2026-11-07");
    if (skipped.status !== "claimed") throw new Error("Couldn't claim the skipped lesson");
    await lessons.skipLesson(user.id, skipped.lessonId, {
      kind: "cap_reached",
      reason: "Today's spending cap was reached, so no lesson was written.",
    });

    await page.goto("/lessons");

    const list = page.getByRole("list", { name: "Your lessons" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    // Newest first: the skipped day, then the lesson.
    await expect(list.getByRole("listitem").first()).toContainText(
      "Today's spending cap was reached, so no lesson was written.",
    );
    await expect(list.getByRole("listitem").first().getByRole("link")).toHaveCount(0);
    const row = list.getByRole("link", { name: new RegExp(TOPIC) });
    await expect(row).toContainText("Wed 4 Nov 2026");
    await expect(row).toContainText("AI-written");
  });

  test("tells a user with no lessons when they arrive", async ({ page }) => {
    await page.goto("/lessons");

    await expect(page.getByRole("heading", { name: "No lessons yet" })).toBeVisible();
    await expect(page.getByText("Tuesdays and Fridays")).toBeVisible();
  });

  test("reads a lesson, answers its question, and follows a source", async ({
    page,
    user,
    lessons,
    clippings,
  }) => {
    const { clipping } = await clippings.saveClipping(user.id, {
      url: "https://example.com/starter",
      note: "Feeding schedule",
      source: "web",
    });
    await writeLesson(lessons, user.id, "2026-11-04", [clipping.id]);

    await page.goto("/lessons");
    await page.getByRole("link", { name: new RegExp(TOPIC) }).click();

    await expect(page).toHaveURL(/\/lessons\/[^/]+$/);
    await expect(page.getByRole("heading", { name: TOPIC })).toBeVisible();
    // Scoped: the list it came from may still be leaving in the page transition.
    await expect(page.getByRole("article").getByText("AI-written")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Last time" })).toBeVisible();
    await expect(page.getByText("hydration")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Wild yeast" })).toBeVisible();

    // Nothing is revealed, and nothing can be checked, until a choice is made.
    const check = page.getByRole("button", { name: "Check answer" });
    await expect(check).toBeDisabled();
    await expect(page.getByText(QUIZ.explanation)).toHaveCount(0);

    // React Aria hides the radio input itself: the label is what a pointer hits.
    await page.getByText("Salt", { exact: true }).click();
    await check.click();

    await expect(page.getByText("Not quite.")).toBeVisible();
    await expect(page.getByText(QUIZ.explanation)).toBeVisible();
    await expect(page.locator("label", { hasText: "Flour" })).toContainText("Correct answer");
    await expect(page.locator("label", { hasText: "Salt" })).toContainText("Your pick");
    await expect(check).toHaveCount(0);

    await page
      .getByRole("region", { name: "Drawn from" })
      .getByRole("link", { name: /example\.com\/starter/ })
      .click();
    await expect(page).toHaveURL(`/c/${clipping.id}`);
  });

  test("a lesson that is still being written or was skipped shows why on its page", async ({
    page,
    user,
    lessons,
  }) => {
    const claim = await lessons.claimLesson(user.id, "2026-11-04");
    if (claim.status !== "claimed") throw new Error("Couldn't claim the lesson");

    await page.goto(`/lessons/${claim.lessonId}`);
    await expect(page.getByRole("heading", { name: "Being written now" })).toBeVisible();

    await lessons.skipLesson(user.id, claim.lessonId, {
      kind: "nothing_to_teach",
      reason: "There was nothing new in your library to teach.",
    });
    await page.reload();

    await expect(page.getByRole("heading", { name: "Skipped" })).toBeVisible();
    await expect(page.getByText("There was nothing new in your library to teach.")).toBeVisible();
  });

  test("another user's lesson is not found", async ({ page, createUser, lessons }) => {
    const owner = await createUser();
    const lessonId = await writeLesson(lessons, owner.id, "2026-11-04", []);

    await page.goto(`/lessons/${lessonId}`);

    await expect(page.getByRole("heading", { name: "This lesson isn't here." })).toBeVisible();
    await expect(page.getByText(TOPIC)).toHaveCount(0);
    await expect(page.getByText("Wild yeast")).toHaveCount(0);
    await page.goto("/lessons");
    await expect(page.getByRole("heading", { name: "No lessons yet" })).toBeVisible();
  });
});
