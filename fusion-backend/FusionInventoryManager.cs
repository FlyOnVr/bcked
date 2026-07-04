using System;
using System.Collections;
using UnityEngine;

namespace FusionBackend
{
    [Serializable]
    public class CatalogItem
    {
        public string item_id;
        public string name;
        public string description;
        public string currency_code;
        public int price;
        public string icon_url;
        public string item_class;
    }

    [Serializable]
    public class CatalogResponse
    {
        public CatalogItem[] catalog;
    }

    [Serializable]
    public class InventoryItem
    {
        public string instance_id;
        public string item_id;
        public string name;
        public string item_class;
        public int quantity;
        public string acquired_at;
    }

    [Serializable]
    public class InventoryResponse
    {
        public InventoryItem[] inventory;
    }

    [Serializable]
    public class PurchaseResponse
    {
        public bool success;
        public string instance_id;
        public string item_id;
        public int quantity;
    }

    public class FusionInventoryManager : MonoBehaviour
    {
        public static FusionInventoryManager Instance { get; private set; }

        private void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        public void GetCatalog(Action<CatalogItem[]> onSuccess, Action<string> onError)
        {
            StartCoroutine(FusionAPIClient.Instance.Get("/api/catalog", false, (success, response) =>
            {
                if (!success) { onError?.Invoke(response); return; }
                var parsed = JsonUtility.FromJson<CatalogResponse>(response);
                onSuccess?.Invoke(parsed.catalog);
            }));
        }

        public void GetInventory(Action<InventoryItem[]> onSuccess, Action<string> onError)
        {
            StartCoroutine(FusionAPIClient.Instance.Get("/api/inventory", true, (success, response) =>
            {
                if (!success) { onError?.Invoke(response); return; }
                var parsed = JsonUtility.FromJson<InventoryResponse>(response);
                onSuccess?.Invoke(parsed.inventory);
            }));
        }

        /// <summary>
        /// Purchase an item from the catalog using the player's currency.
        /// Fails server-side with "Insufficient funds" if they can't afford it.
        /// </summary>
        public void PurchaseItem(string itemId, int quantity, Action<PurchaseResponse> onSuccess, Action<string> onError)
        {
            string json = $"{{\"item_id\":\"{itemId}\",\"quantity\":{quantity}}}";
            StartCoroutine(FusionAPIClient.Instance.Post("/api/store/purchase", json, true, (success, response) =>
            {
                if (!success) { onError?.Invoke(response); return; }
                var parsed = JsonUtility.FromJson<PurchaseResponse>(response);
                onSuccess?.Invoke(parsed);
            }));
        }
    }
}
