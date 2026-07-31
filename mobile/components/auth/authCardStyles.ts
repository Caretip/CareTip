import { StyleSheet } from "react-native";
import { authBrand } from "@/theme/authBrand";
import { colors, radius, spacing, touchTarget, typography } from "@/theme";

/** Shared auth card typography and rhythm — single source for optical balance. */
export const authCardStyles = StyleSheet.create({
  cardHeader: {
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  cardEyebrow: {
    ...typography.overline,
    color: authBrand.orange,
    letterSpacing: 1.2,
  },
  cardTitle: {
    ...typography.hero,
    color: authBrand.dark,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  cardSubtitle: {
    ...typography.body,
    color: authBrand.muted,
    fontSize: 14,
    lineHeight: 22,
  },
  fields: {
    gap: spacing.xl,
  },
  formBlock: {
    gap: spacing["2xl"],
  },
  formError: {
    ...typography.caption,
    color: colors.destructive,
    fontWeight: "600",
  },
  backRow: {
    minHeight: touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  backLink: {
    ...typography.body,
    color: authBrand.orange,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.78,
  },
  roleRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  roleChip: {
    flex: 1,
    minHeight: touchTarget,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(11, 18, 32, 0.14)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  roleChipActive: {
    backgroundColor: "rgba(255, 107, 26, 0.12)",
    borderColor: authBrand.orange,
  },
  roleChipLabel: {
    ...typography.caption,
    color: authBrand.muted,
    fontWeight: "600",
  },
  roleChipLabelActive: {
    color: authBrand.orange,
  },
});
