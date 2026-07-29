import { useMemo, useState, useEffect } from "react";
import { LayoutAnimation, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { InfoScreenShell } from "@/components/info/InfoScreenShell";
import { getLocalizedFaqItems } from "@/utils/infoI18n";
import { useI18n } from "@/hooks/useI18n";
import { authBrand } from "@/theme/authBrand";
import { colors, radius, spacing, touchTarget, typography } from "@/theme";

export function FaqScreen() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const allItems = useMemo(() => getLocalizedFaqItems(t), [t]);

  useEffect(() => {
    if (openId == null && allItems[0]?.id) {
      setOpenId(allItems[0].id);
    }
  }, [allItems, openId]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter(
      (item) =>
        item.question.toLowerCase().includes(q) || item.answer.toLowerCase().includes(q),
    );
  }, [query, allItems]);

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
              style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
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
  cardPressed: {
    opacity: 0.92,
    backgroundColor: colors.secondary,
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
