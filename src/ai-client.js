import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const SUPABASE_URL = "https://ldyqtqpvdrnxinlbxsvz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1RSIhOJ0kd23Qv0AaDMvTw_zLuJfkyU";
const FUNCTION_NAME = "interpret-wod";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

async function ensureAnonymousSession() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error("No se ha podido recuperar la sesión de Throwdown Timer.");
  if (sessionData.session) return sessionData.session;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.session) {
    throw new Error("No se ha podido iniciar la sesión anónima. Comprueba que los usuarios anónimos estén habilitados en Supabase.");
  }
  return data.session;
}

export async function interpretWod(sourceText) {
  await ensureAnonymousSession();
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: { sourceText },
  });
  if (error) {
    let serverMessage = data?.error;
    if (!serverMessage && error.context && typeof error.context.clone === "function") {
      try {
        const payload = await error.context.clone().json();
        serverMessage = payload?.error;
      } catch {
        // The function gateway may return a non-JSON error response.
      }
    }
    const message = serverMessage || error.message;
    throw new Error(message || "El servicio de interpretación no está disponible.");
  }
  if (!data?.result) throw new Error(data?.error || "La IA no ha devuelto una interpretación válida.");
  return data.result;
}
