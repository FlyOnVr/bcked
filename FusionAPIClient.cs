using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace FusionBackend
{
    /// <summary>
    /// Low-level HTTP client for talking to the Fusion Backend (Flask on Render).
    /// All other manager scripts (Auth, Currency, Inventory, CloudSave) route through this.
    /// </summary>
    public class FusionAPIClient : MonoBehaviour
    {
        public static FusionAPIClient Instance { get; private set; }

        [Tooltip("Your Render backend URL, e.g. https://your-app.onrender.com (no trailing slash)")]
        public string backendUrl = "https://your-app.onrender.com";

        // Set after login via FusionAuthManager
        public string SessionToken { get; set; }
        public string PlayerId { get; set; }

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        public IEnumerator Post(string path, string jsonBody, bool authorized, Action<bool, string> callback)
        {
            string url = backendUrl + path;
            byte[] bodyRaw = Encoding.UTF8.GetBytes(jsonBody ?? "{}");

            using (UnityWebRequest req = new UnityWebRequest(url, "POST"))
            {
                req.uploadHandler = new UploadHandlerRaw(bodyRaw);
                req.downloadHandler = new DownloadHandlerBuffer();
                req.SetRequestHeader("Content-Type", "application/json");
                if (authorized && !string.IsNullOrEmpty(SessionToken))
                    req.SetRequestHeader("Authorization", "Bearer " + SessionToken);

                yield return req.SendWebRequest();
                HandleResponse(req, callback);
            }
        }

        public IEnumerator Get(string path, bool authorized, Action<bool, string> callback)
        {
            string url = backendUrl + path;

            using (UnityWebRequest req = UnityWebRequest.Get(url))
            {
                if (authorized && !string.IsNullOrEmpty(SessionToken))
                    req.SetRequestHeader("Authorization", "Bearer " + SessionToken);

                yield return req.SendWebRequest();
                HandleResponse(req, callback);
            }
        }

        private void HandleResponse(UnityWebRequest req, Action<bool, string> callback)
        {
#if UNITY_2020_1_OR_NEWER
            bool success = req.result == UnityWebRequest.Result.Success;
#else
            bool success = !req.isNetworkError && !req.isHttpError;
#endif
            if (success)
            {
                callback?.Invoke(true, req.downloadHandler.text);
            }
            else
            {
                string errorBody = req.downloadHandler != null ? req.downloadHandler.text : req.error;
                Debug.LogWarning($"[FusionBackend] Request failed: {req.error} | {errorBody}");
                callback?.Invoke(false, string.IsNullOrEmpty(errorBody) ? req.error : errorBody);
            }
        }
    }
}
