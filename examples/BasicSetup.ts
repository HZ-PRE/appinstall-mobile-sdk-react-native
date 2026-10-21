import AppInstall from "@appinstall/mobile-sdk-react-native";
export async function initializeAttribution() {
  AppInstall.onDeferredDeepLink((data) => {
    // Route using data?.customParameters; avoid logging real production parameters.
    console.log("Attribution parameters available:", !!data?.customParameters);
  });
  return AppInstall.init({
    baseUrl: "https://your-service.example",
    attributionAppId: "application-id-from-dashboard",
    appScheme: "yourapp",
    appToken: "public-sdk-token-from-dashboard",
    clipboardAttribution: true,
  });
}
