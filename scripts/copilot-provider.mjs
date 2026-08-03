import { CopilotClient } from "@github/copilot-sdk";
import { fileURLToPath } from "node:url";

let clientPromise = null;

function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const client = new CopilotClient({
        mode: "copilot-cli",
        workingDirectory: fileURLToPath(new URL("../", import.meta.url)),
        logLevel: "error",
        useLoggedInUser: true
      });
      await client.start();
      return client;
    })().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

function cleanContent(value) {
  return String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export async function copilotHealth() {
  const client = await getClient();
  const models = await client.listModels();
  return {
    status: "ok",
    models: models.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      capabilities: model.capabilities || null
    }))
  };
}

export async function copilotComplete(payload) {
  const client = await getClient();
  const model = payload?.model && payload.model !== "local-gemma" ? payload.model : "auto";
  const prompt = (payload?.messages || [])
    .map((message) => `${String(message.role || "user").toUpperCase()}:\n${message.content}`)
    .join("\n\n")
    + (payload?.response_format?.json_schema?.schema
      ? `\n\nREQUIRED_JSON_SCHEMA:\n${JSON.stringify(payload.response_format.json_schema.schema)}`
      : "");
  const session = await client.createSession({
    model,
    enableSessionStore: false,
    availableTools: [],
    excludedTools: ["builtin:*", "mcp:*", "custom:*"],
    onPermissionRequest: () => ({
      kind: "reject",
      feedback: "The Common Confessor disables every Copilot tool. This session may generate text only."
    })
  });
  try {
    const response = await session.sendAndWait({ prompt }, Number(payload?.timeout_ms) || 90000);
    const content = cleanContent(response?.data?.content);
    if (!content) throw new Error("Copilot returned no usable content");
    return {
      choices: [{ message: { content } }]
    };
  } finally {
    await session.disconnect().catch(() => {});
  }
}

export async function stopCopilotProvider() {
  if (!clientPromise) return;
  const client = await clientPromise.catch(() => null);
  clientPromise = null;
  await client?.stop().catch(() => {});
}
