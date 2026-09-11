import { Stack } from "expo-router";

export default function EmployeePaymentsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        animationDuration: 240,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="history" />
    </Stack>
  );
}
