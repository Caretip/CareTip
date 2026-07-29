import { Stack } from "expo-router";

export default function BusinessSettingsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="general" />
      <Stack.Screen name="appearance" />
      <Stack.Screen name="business-profile" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="security" />
      <Stack.Screen name="integrations" />
    </Stack>
  );
}
