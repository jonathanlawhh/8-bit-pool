export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  ssr: false,
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: '8 Bit Pool // 8 Ball Pool, but for nerds',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content:
            'Turn-based 2D neon 8-bit 8-Ball Pool built for programmers, math/physics education, and LLM AI opponents (OpenAI & Gemini).',
        },
      ],
    },
  },
  nitro: {
    preset: 'static',
  },
});
