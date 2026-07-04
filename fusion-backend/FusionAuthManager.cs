using System;
using System.Collections;
using UnityEngine;

namespace FusionBackend
{
    [Serializable]
    public class LoginResponse
    {
        public string player_id;
        public string session_token;
        public string display_name;
        public bool is_new_player;
    }

    /// <summary>
    /// Handles first-launch device ID generation and login.
    /// Attach alongside FusionAPIClient (or on the same GameObject) and call Login() on startup.
    /// </summary>
    public class FusionAuthManager : MonoBehaviour
    {
        public static FusionAuthManager Instance { get; private set; }

        private const string DeviceIdKey = "fusion_device_id";

        public bool IsLoggedIn { get; private set; }
        public string PlayerId => FusionAPIClient.Instance.PlayerId;

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

        /// <summary>
        /// Call this once on game start (e.g. from a bootstrap scene).
        /// Creates a new PlayFab-style player ID automatically on first launch.
        /// </summary>
        public void Login(Action<LoginResponse> onSuccess, Action<string> onError)
        {
            string deviceId = GetOrCreateDeviceId();
            string json = JsonUtility.ToJson(new LoginRequest { device_id = deviceId });

            StartCoroutine(FusionAPIClient.Instance.Post("/api/auth/login", json, false, (success, response) =>
            {
                if (!success)
                {
                    onError?.Invoke(response);
                    return;
                }

                LoginResponse parsed = JsonUtility.FromJson<LoginResponse>(response);
                FusionAPIClient.Instance.SessionToken = parsed.session_token;
                FusionAPIClient.Instance.PlayerId = parsed.player_id;
                IsLoggedIn = true;

                if (parsed.is_new_player)
                    Debug.Log($"[FusionBackend] New player created: {parsed.player_id}");
                else
                    Debug.Log($"[FusionBackend] Welcome back: {parsed.player_id}");

                onSuccess?.Invoke(parsed);
            }));
        }

        /// <summary>
        /// The device ID is a random GUID persisted locally — this is what lets the backend
        /// recognize "the same player" across sessions and create a new PlayFab-style ID
        /// only the very first time.
        /// </summary>
        private string GetOrCreateDeviceId()
        {
            if (PlayerPrefs.HasKey(DeviceIdKey))
                return PlayerPrefs.GetString(DeviceIdKey);

            string newId = SystemInfo.deviceUniqueIdentifier;
            // Fallback for platforms where deviceUniqueIdentifier isn't reliable (e.g. some editors)
            if (string.IsNullOrEmpty(newId) || newId == SystemInfo.unsupportedIdentifier)
                newId = Guid.NewGuid().ToString();

            PlayerPrefs.SetString(DeviceIdKey, newId);
            PlayerPrefs.Save();
            return newId;
        }

        [Serializable]
        private class LoginRequest
        {
            public string device_id;
        }
    }
}
