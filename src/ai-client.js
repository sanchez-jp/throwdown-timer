import { createClient, FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "https://esm.sh/@supabase/supabase-js@2.95.0";

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

export async function interpretWod(source) {
  const body = typeof source === "string" ? { sourceText: source } : source;
  if (!body || (typeof body.sourceText !== "string" && !body.image)) {
    throw new Error("Introduce un WOD o selecciona una imagen para interpretarlo.");
  }
  await ensureAnonymousSession();
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body,
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      let serverMessage = data?.error;
      try {
        const payload = await error.context.clone().json();
        serverMessage = payload?.error || serverMessage;
      } catch {
        // La función puede devolver una respuesta no JSON.
      }
      throw new Error(serverMessage || `La función de interpretación ha respondido con un error HTTP (${error.context.status}).`);
    }
    if (error instanceof FunctionsRelayError) {
      console.error("[Throwdown Timer] Error de relay de Supabase", error);
      throw new Error("Supabase ha recibido la petición, pero ha fallado la comunicación con la función. Espera unos segundos y vuelve a intentarlo.");
    }
    if (error instanceof FunctionsFetchError) {
      console.error("[Throwdown Timer] No se ha podido alcanzar la Edge Function", error);
      throw new Error("No se ha podido conectar con el servicio de interpretación de Supabase. Comprueba tu conexión y vuelve a intentarlo.");
    }
    console.error("[Throwdown Timer] Error al invocar la Edge Function", error);
    throw new Error("No se ha podido completar la petición al servicio de interpretación. Inténtalo de nuevo.");
  }
  if (!data?.result) throw new Error(data?.error || "La IA no ha devuelto una interpretación válida.");
  return data.result;
}
