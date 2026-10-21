import { createOwnerConnections } from "./owner-connection.js";
import { closeDatabase } from "./database.js";

try {
  const connection = await createOwnerConnections().begin();
  // The one-time command is shown only to the workspace administrator.
  // The database stores its hash, never the command or the bot token.
  console.info(connection.command);
  console.info("Private chat only; expires in 15 minutes. Do not share this command.");
} finally {
  await closeDatabase();
}
