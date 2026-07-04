using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace FusionBackend
{
    [Serializable]
    public class CurrencyDict
    {
        // Unity's JsonUtility can't parse arbitrary dictionaries directly,
        // so we parse the raw JSON manually for this one endpoint.
        public Dictionary<string, int> currencies;
    }

    public class FusionCurrencyManager : MonoBehaviour
    {
        public static FusionCurrencyManager Instance { get; private set; }

        private void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        public void GetCurrencies(Action<Dictionary<string, int>> onSuccess, Action<string> onError)
        {
            StartCoroutine(FusionAPIClient.Instance.Get("/api/currency", true, (success, response) =>
            {
                if (!success) { onError?.Invoke(response); return; }
                var result = MiniJsonParseCurrencies(response);
                onSuccess?.Invoke(result);
            }));
        }

        public void AddCurrency(string currencyCode, int amount, Action<int> onSuccess, Action<string> onError)
        {
            string json = $"{{\"currency_code\":\"{currencyCode}\",\"amount\":{amount}}}";
            StartCoroutine(FusionAPIClient.Instance.Post("/api/currency/add", json, true, (success, response) =>
            {
                if (!success) { onError?.Invoke(response); return; }
                var wrapper = JsonUtility.FromJson<CurrencyChangeResponse>(response);
                onSuccess?.Invoke(wrapper.amount);
            }));
        }

        public void SubtractCurrency(string currencyCode, int amount, Action<int> onSuccess, Action<string> onError)
        {
            string json = $"{{\"currency_code\":\"{currencyCode}\",\"amount\":{amount}}}";
            StartCoroutine(FusionAPIClient.Instance.Post("/api/currency/subtract", json, true, (success, response) =>
            {
                if (!success) { onError?.Invoke(response); return; } // e.g. "Insufficient funds"
                var wrapper = JsonUtility.FromJson<CurrencyChangeResponse>(response);
                onSuccess?.Invoke(wrapper.amount);
            }));
        }

        [Serializable]
        private class CurrencyChangeResponse
        {
            public string currency_code;
            public int amount;
        }

        // Minimal manual parse since JsonUtility doesn't support dictionaries.
        // Expects: {"currencies": {"GOLD": 100, "GEMS": 5}}
        private Dictionary<string, int> MiniJsonParseCurrencies(string json)
        {
            var result = new Dictionary<string, int>();
            int braceStart = json.IndexOf('{', json.IndexOf("currencies"));
            int braceEnd = json.IndexOf('}', braceStart);
            if (braceStart < 0 || braceEnd < 0) return result;

            string inner = json.Substring(braceStart + 1, braceEnd - braceStart - 1).Trim();
            if (string.IsNullOrEmpty(inner)) return result;

            foreach (string pair in inner.Split(','))
            {
                string[] kv = pair.Split(':');
                if (kv.Length != 2) continue;
                string key = kv[0].Trim().Trim('"');
                if (int.TryParse(kv[1].Trim(), out int value))
                    result[key] = value;
            }
            return result;
        }
    }
}
