import { useMemo, useState } from "react";
import { LayoutAnimation, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { InfoScreenShell } from "@/components/info/InfoScreenShell";
import { MOBILE_FAQ_ITEMS } from "@/constants/infoContent";
import { useI18n } from "@/hooks/useI18n";
import { authBrand } from "@/theme/authBrand";
import { colors, radius, spacing, touchTarget, typography } from "@/theme";

export function FaqScreen() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(MOBILE_FAQ_ITEMS[0]?.id ?? null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MOBILE_FAQ_ITEMS;
    return MOBILE_FAQ_ITEMS.filter(
      (item) =>
        item.question.toLowerCase().includes(q) || item.answer.toLowerCase().includes(q),
    );
  }, [query]);

  const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenId((prev) => (prev === id ? null : id));
  };

  return (
    <InfoScreenShell title={t("info.faqTitle")}>
      <View style={styles.search}>
        <Ionicons name="search" size={18} color={colors.mutedForeground} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("info.faqSearch")}
          placeholderTextColor={colors.mutedForeground}
          style={styles.searchInput}
          accessibilityLabel={t("info.faqSearch")}
        />
        {query ? (
          <Pressable onPress={() => setQuery("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      {items.length === 0 ? (
        <Text style={styles.empty}>{t("info.faqEmpty")}</Text>
      ) : (
        items.map((item) => {
          const open = openId === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => toggle(item.id)}
              style={styles.card}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.question}>{item.question}</Text>
                <Ionicons
                  name={open ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={authBrand.orange}
                />
              </View>
              {open ? <Text style={styles.answer}>{item.answer}</Text> : null}
            </Pressable>
          );
        })
      )}
    </InfoScreenShell>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: touchTarget,
    borderRadius: radius.xl,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  searchInput: {
    ...typography.body,
    flex: 1,
    color: colors.foreground,
    paddingVertical: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing.md,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  question: {
    ...typography.h2,
    fontSize: 16,
    color: colors.foreground,
    flex: 1,
  },
  answer: {
    ...typography.body,
    color: colors.mutedForeground,
    lineHeight: 22,
  },
  empty: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: "center",
    paddingVertical: spacing["3xl"],
  },
});
