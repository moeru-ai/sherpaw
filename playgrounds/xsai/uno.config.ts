import { defineConfig, presetAttributify, presetIcons, presetWebFonts, presetWind4 } from 'unocss'

export default defineConfig({
  presets: [
    presetWind4(),
    presetAttributify(),
    presetWebFonts({
      fonts: {
        sans: {
          name: 'Zalando Sans SemiExpanded',
          weights: [400, 600, 700, 900],
        },
        mono: {
          name: 'Google Sans Code',
          weights: [400, 700],
        },
      },
    }),
    presetIcons(),
  ],
})
