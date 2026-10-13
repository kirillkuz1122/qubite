import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class QColors {
  QColors._();

  static const Color bg1 = Color(0xFF0B1220);
  static const Color bg2 = Color(0xFF020617);
  static const Color bgDark = Color(0xFF11141D);
  static const Color fg = Color(0xFFE2E8F0);
  static const Color fgStrong = Color(0xFFF8FAFC);
  static const Color fgMuted = Color(0xFF94A3B8);
  static const Color border = Color(0x1AFFFFFF);
  static const Color card = Color(0x0FFFFFFF);
  static const Color accentFrom = Color(0xFFF43F5E);
  static const Color accentTo = Color(0xFFF59E0B);
  static const Color green = Color(0xFF22C55E);
  static const Color ok = Color(0xFF10B981);
  static const Color warning = Color(0xFFF59E0B);
  static const Color danger = Color(0xFFEF4444);

  static const LinearGradient accentGradient = LinearGradient(
    colors: [accentFrom, accentTo],
  );
}

class QTheme {
  QTheme._();

  static ThemeData get dark {
    final base = ThemeData.dark(useMaterial3: true);
    return base.copyWith(
      scaffoldBackgroundColor: QColors.bg1,
      colorScheme: ColorScheme.dark(
        primary: QColors.accentFrom,
        secondary: QColors.accentTo,
        surface: QColors.bg2,
        error: QColors.danger,
      ),
      cardTheme: CardThemeData(
        color: QColors.card,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: QColors.border),
        ),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        centerTitle: true,
        titleTextStyle: GoogleFonts.jura(
          fontSize: 20,
          fontWeight: FontWeight.w700,
          color: QColors.fgStrong,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: QColors.accentFrom,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: GoogleFonts.manrope(
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: QColors.fg,
          side: const BorderSide(color: QColors.border),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: QColors.bg2,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: QColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: QColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: QColors.accentFrom, width: 1.5),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        hintStyle: GoogleFonts.manrope(color: QColors.fgMuted),
        labelStyle: GoogleFonts.manrope(color: QColors.fgMuted),
      ),
      textTheme: GoogleFonts.manropeTextTheme(base.textTheme).apply(
        bodyColor: QColors.fg,
        displayColor: QColors.fgStrong,
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: QColors.bgDark,
        contentTextStyle: GoogleFonts.manrope(color: QColors.fg),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}
