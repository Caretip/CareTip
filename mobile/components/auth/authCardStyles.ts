import { StyleSheet } from "react-native";
import { authBrand } from "@/theme/authBrand";
import { radius, spacing, touchTarget, typography } from "@/theme";

/** Floating auth typography — light text on hero image, no white card. */
export const authCardStyles = StyleSheet.create({
  cardHeader: {
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  cardEyebrow: {
    ...typography.overline,
    color: authBrand.heroEyebrow,
    letterSpacing: 1.4,
  },
  cardTitle: {
    ...typography.hero,
    color: authBrand.heroTitle,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.6,
  },
  cardSubtitle: {
    ...typography.body,
    color: authBrand.heroSubtitle,
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "500",
  },
  fields: {
    gap: spacing["2xl"],
  },
  formBlock: {
    gap: spacing["3xl"],
  },
  formError: {
    ...typography.caption,
    color: "#FCA5A5",
    fontWeight: "600",
    textAlign: "center",
  },
  backRow: {
    minHeight: touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  backLink: {
    ...typography.body,
    color: authBrand.orangeSoft,
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
    borderColor: authBrand.fieldBorder,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    backgroundColor: authBrand.fieldFill,
  },
  roleChipActive: {
    backgroundColor: "rgba(235, 153, 44, 0.22)",
    borderColor: authBrand.orange,
  },
  roleChipLabel: {
    ...typography.caption,
    color: authBrand.fieldLabel,
    fontWeight: "600",
  },
  roleChipLabelActive: {
    color: authBrand.orangeSoft,
  },
});

/** Divider for floating auth forms on hero background. */
export const authFloatingDivider = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
  },
  label: {
    ...typography.caption,
    color: authBrand.fieldLabel,
    fontWeight: "600",
    fontSize: 12,
  },
});
