// Read-only projection of the bot's canonical checked state. Completing a task
// does not destroy its history or introduce a second status/database writer.
export function openTasksFromState(state: any, userId: string) {
  const tasks = Object.entries(state.lists?.[userId] ?? {})
    .filter(([name]) => /משימ|מטר|יעד/.test(name))
    .flatMap(([listName, items]) => (items as Array<any>)
      .filter(item => item.checked !== true)
      .map(item => ({
        id: item.id as string, listName, text: item.text as string,
        checked: false as const, status: "open" as const,
        createdAt: item.createdAt ?? null,
        ...(item.dueAt !== undefined ? { dueAt: item.dueAt } : {}),
      })));
  return { tasks, count: tasks.length };
}
