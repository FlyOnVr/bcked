using System;
using System.Collections;
using UnityEngine;

namespace FusionBackend
{
    /// <summary>
    /// Cloud save (player data). Values are stored as raw JSON strings, so you can
    /// save anything JSON-serializable: floats, strings, or whole objects.
    /// </summary>
    public class FusionCloudSaveManager : MonoBehaviour
    {
        public static FusionCloudSaveManager Instance { get; private set; }

        private void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        /// <summary>
        /// Save a single key/value. Value can be any JSON-serializable object
        /// (use JsonUtility.ToJson on your own class first if it's complex, then pass as a string).
        /// </summary>
        public void SaveValue(string key, object value, Action onSuccess, Action<string> onError)
        {
            string valueJson = JsonUtility.ToJson(new Wrapper { v = value?.ToString() });
            // Build {"data": {"key": "value"}} — value is embedded as a raw JSON string
            string json = "{\"data\":{\"" + key + "\":\"" + EscapeJson(value?.ToString() ?? "") + "\"}}";

            StartCoroutine(FusionAPIClient.Instance.Post("/api/data", json, true, (success, response) =>
            {
                if (success) onSuccess?.Invoke();
                else onError?.Invoke(response);
            }));
        }

        /// <summary>
        /// Fetch all cloud save data as a raw JSON string. Parse the specific keys you need
        /// with JsonUtility.FromJson on your own data class, or a small manual parse.
        /// </summary>
        public void LoadAll(Action<string> onSuccess, Action<string> onError)
        {
            StartCoroutine(FusionAPIClient.Instance.Get("/api/data", true, (success, response) =>
            {
                if (success) onSuccess?.Invoke(response);
                else onError?.Invoke(response);
            }));
        }

        private string EscapeJson(string s)
        {
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        [Serializable]
        private class Wrapper { public string v; }
    }
}
