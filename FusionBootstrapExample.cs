using UnityEngine;

namespace FusionBackend
{
    /// <summary>
    /// EXAMPLE ONLY — shows how to wire up login + currency + inventory calls.
    /// Put FusionAPIClient, FusionAuthManager, FusionCurrencyManager, FusionCloudSaveManager,
    /// and FusionInventoryManager all on one persistent GameObject (e.g. "BackendManager")
    /// in your first scene, then call FusionAuthManager.Instance.Login(...) from here.
    /// </summary>
    public class FusionBootstrapExample : MonoBehaviour
    {
        private void Start()
        {
            FusionAuthManager.Instance.Login(
                onSuccess: (loginResult) =>
                {
                    Debug.Log($"Logged in as {loginResult.player_id} (new: {loginResult.is_new_player})");

                    // Example: check currency after login
                    FusionCurrencyManager.Instance.GetCurrencies(
                        onSuccess: (currencies) =>
                        {
                            foreach (var kvp in currencies)
                                Debug.Log($"Currency {kvp.Key}: {kvp.Value}");
                        },
                        onError: (err) => Debug.LogError("Failed to fetch currencies: " + err)
                    );

                    // Example: load the store catalog
                    FusionInventoryManager.Instance.GetCatalog(
                        onSuccess: (items) =>
                        {
                            foreach (var item in items)
                                Debug.Log($"Catalog item: {item.name} — {item.price} {item.currency_code}");
                        },
                        onError: (err) => Debug.LogError("Failed to fetch catalog: " + err)
                    );

                    // Example: save a cloud value (e.g. last unlocked level)
                    FusionCloudSaveManager.Instance.SaveValue(
                        key: "last_level_unlocked",
                        value: "3",
                        onSuccess: () => Debug.Log("Progress saved to cloud."),
                        onError: (err) => Debug.LogError("Save failed: " + err)
                    );
                },
                onError: (err) => Debug.LogError("Login failed: " + err)
            );
        }
    }
}
