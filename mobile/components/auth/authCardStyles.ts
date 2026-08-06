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
    letterSpacing: 3.2,
  },
  cardTitle: {
    ...typography.h1,
    color: authBrand.heroTitle,
    fontWeight: "800",
  },
  cardSubtitle: {
    ...typography.smallBody,
    color: authBrand.heroSubtitle,
    marginTop: spacing.xxs,
  },
  fields: {
    gap: spacing["2xl"],
  },
  formBlock: {
    gap: spacing["3xl"],
  },
  formError: {
    ...typography.caption,
    color: authBrand.fieldError,
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
    color: authBrand.orangeMuted,
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
    borderRadius: radius["2xl"],
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
    color: authBrand.orangeMuted,
  },
});

/** Divider for floating auth forms on hero background. */
export const authFloatingDivider = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginVertical: spacing.xs,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: authBrand.fieldBorder,
  },
  label: {
    ...typography.caption,
    color: authBrand.fieldLabel,
    fontWeight: "600",
    fontSize: 11,
    letterSpacing: 0.4,
  },
});

/** Forgot-password link aligned to input column. */
export const authForgotStyles = StyleSheet.create({
  row: {
    alignSelf: "stretch",
    alignItems: "flex-end",
    marginTop: -spacing.sm,
    marginBottom: spacing.xs,
  },
  label: {
    ...typography.caption,
    color: authBrand.orangeMuted,
    fontWeight: "600",
    fontSize: 12,
    letterSpacing: 0.1,
  },
  link: {
    minHeight: touchTarget - 8,
    justifyContent: "center",
    paddingVertical: spacing.xs,
  },
});
