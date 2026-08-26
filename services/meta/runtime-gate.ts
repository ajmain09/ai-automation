type ConnectionShape = {
  status: string;
  encryptedToken?: string | null;
} | null | undefined;

export type FacebookTransportState = {
  metaPageId?: string | null;
  connectionStatus: string;
  connection?: ConnectionShape;
};

export type MessengerRuntimeState = FacebookTransportState & {
  isActive: boolean;
  lifecycleStatus: string;
  aiEnabled: boolean;
  aiStatus: string;
};

export type RuntimeGateResult =
  | { ok: true }
  | { ok: false; reason: string };

export function checkFacebookTransport(state: FacebookTransportState): RuntimeGateResult {
  if (state.connectionStatus !== "CONNECTED") return { ok: false, reason: "page_connection_not_connected" };
  if (state.connection?.status !== "CONNECTED") return { ok: false, reason: "connection_not_connected" };
  if (!state.metaPageId) return { ok: false, reason: "meta_page_id_missing" };
  if (!state.connection.encryptedToken) return { ok: false, reason: "meta_token_missing" };
  return { ok: true };
}

export function checkMessengerRuntime(state: MessengerRuntimeState): RuntimeGateResult {
  if (!state.isActive) return { ok: false, reason: "page_inactive" };
  if (state.lifecycleStatus !== "LIVE") return { ok: false, reason: "page_not_live" };
  if (!state.aiEnabled) return { ok: false, reason: "ai_disabled" };
  if (state.aiStatus !== "RUNNING") return { ok: false, reason: "ai_not_running" };
  return checkFacebookTransport(state);
}
