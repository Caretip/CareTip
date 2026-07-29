import { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { WebView } from "react-native-webview";
import { useI18n } from "@/hooks/useI18n";
import { colors, radius, spacing, typography } from "@/theme";

type LegalDocumentViewProps = {
  title: string;
  contentHtml: string;
  version?: string;
  updatedAt?: string;
};

function wrapLegalHtml(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 16px 4px 32px;
      line-height: 1.55;
      font-size: 15px;
    }
    h1, h2, h3 { color: #0f172a; line-height: 1.25; margin-top: 1.4em; }
    h1 { font-size: 1.35rem; margin-top: 0; }
    h2 { font-size: 1.15rem; }
    h3 { font-size: 1.05rem; }
    p, li { color: #475569; }
    a { color: #EB992C; }
    ul, ol { padding-left: 1.2rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

export function LegalDocumentView({ title, contentHtml, version, updatedAt }: LegalDocumentViewProps) {
  const { t, language } = useI18n();
  const { width } = useWindowDimensions();
  const html = useMemo(() => wrapLegalHtml(contentHtml), [contentHtml]);

  const metaLine =
    version && updatedAt
      ? t("info.legalVersionLine", {
          version,
          date: new Date(updatedAt).toLocaleDateString(language),
        })
      : null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {metaLine ? <Text style={styles.meta}>{metaLine}</Text> : null}
      <View style={[styles.webviewFrame, { width: width - spacing.xl * 2 }]}>
        <WebView
          originWhitelist={["about:blank"]}
          source={{ html }}
          style={styles.webview}
          scrollEnabled
          showsVerticalScrollIndicator={false}
          automaticallyAdjustContentInsets={false}
          accessibilityLabel={title}
        />
      </View>
    </View>
  );
}

type LegalDocumentLoadingProps = {
  label?: string;
};

export function LegalDocumentLoading({ label }: LegalDocumentLoadingProps) {
  const { t } = useI18n();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.loadingText}>{label ?? t("info.legalLoading")}</Text>
    </View>
  );
}

type LegalDocumentErrorProps = {
  message: string;
  onRetry?: () => void;
};

export function LegalDocumentError({ message, onRetry }: LegalDocumentErrorProps) {
  const { t } = useI18n();
  return (
    <View style={styles.center} accessibilityRole="alert">
      <Text style={styles.errorText}>{message}</Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.retryBtn, pressed ? styles.pressed : null]}
        >
          <Text style={styles.retryLabel}>{t("common.tryAgain")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type LegalDocumentEmptyProps = {
  message: string;
};

export function LegalDocumentEmpty({ message }: LegalDocumentEmptyProps) {
  return (
    <View style={styles.center}>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
    flex: 1,
    minHeight: 420,
  },
  title: {
    ...typography.h2,
    color: colors.foreground,
  },
  meta: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  webviewFrame: {
    flex: 1,
    minHeight: 480,
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingVertical: spacing["4xl"],
  },
  loadingText: {
    ...typography.body,
    color: colors.mutedForeground,
  },
  errorText: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: "center",
    maxWidth: 320,
  },
  emptyText: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: "center",
    maxWidth: 300,
    lineHeight: 22,
  },
  retryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing["2xl"],
    paddingVertical: spacing.md,
  },
  retryLabel: {
    ...typography.button,
    color: colors.primaryForeground,
  },
  pressed: {
    opacity: 0.88,
  },
});
