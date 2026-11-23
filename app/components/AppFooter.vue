<script setup>
const contact = [
  {
    media: 'Facebook',
    url: 'https://facebook.com/jonathanlawhh',
    icon: 'fb.svg',
  },
  {
    media: 'GitHub',
    url: 'https://github.com/jonathanlawhh',
    icon: 'github.svg',
  },
  {
    media: 'LinkedIn',
    url: 'https://www.linkedin.com/in/jonathanlawhh/',
    icon: 'linkedin.svg',
  },
  {
    media: 'YouTube',
    url: 'https://www.youtube.com/channel/UC3c-D9k1Q4VhbXalew1N-Ag/featured',
    icon: 'youtube.svg',
  },
];

function jumpUp() {
  window.scrollTo({
    top: 0,
    left: 0,
    behavior: 'smooth',
  });
}
</script>

<template>
  <footer class="site-footer">
    <div class="footer-top">
      <div class="footer-actions">
        <a
          href="https://jonathanlawhh.com"
          target="_blank"
          rel="noopener"
          class="a-custom-button"
        >
          jonathanlawhh.com
        </a>
        <button type="button" class="a-custom-button" @click="jumpUp">
          Jump back up
        </button>
      </div>
      <div class="footer-divider" aria-hidden="true" />
    </div>

    <div class="footer-bottom">
      <a
        href="https://jonathanlawhh.com"
        target="_blank"
        rel="noopener"
        class="footer-author a-custom-button"
      >
        <strong>Jonathan Law Hui Hao</strong>
      </a>

      <div class="footer-socials">
        <a
          v-for="c in contact"
          :key="c.media"
          :href="c.url"
          target="_blank"
          rel="noopener"
          class="link-social-media"
          :aria-label="c.media"
          :title="c.media"
        >
          <img :src="`/icons/${c.icon}`" :alt="c.media" loading="lazy" />
        </a>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  --custom-pink: #ff7582;
  max-width: 1480px;
  margin: 0 auto;
  padding: 20px 16px 28px;
}

.footer-top {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-bottom: 10px;
}

.footer-divider {
  width: 41.6667%;
  min-width: 220px;
  border-bottom: 1px solid aliceblue;
}

.footer-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 14px;
}

.footer-author {
  font-size: 13px;
  letter-spacing: 0.02em;
}

.footer-socials {
  display: flex;
  align-items: center;
  gap: 28px;
  margin-left: auto;
}

.a-custom-button {
  position: relative;
  display: inline-block;
  padding: 0 0 4px;
  transition: 0.25s ease-in-out;
  cursor: pointer;
  text-decoration: none;
  color: #ffffff;
  background: none;
  border: none;
  font-size: 13px;
}

.a-custom-button::before {
  width: 0;
  height: 100%;
  content: ' ';
  position: absolute;
  bottom: 0;
  left: 0;
  transition: width 0.2s ease-out;
}

.a-custom-button:hover::before {
  width: 100%;
  border-bottom: 2px var(--custom-pink) solid;
}

.a-custom-button::after {
  width: 100%;
  height: 4px;
  content: ' ';
  position: absolute;
  bottom: -1px;
  left: 0;
  border-bottom: 1px #ffffff solid;
  border-top: 1px #ffffff solid;
  transition: width 0.2s ease-out;
}

.a-custom-button:hover::after {
  width: 0;
}

.link-social-media {
  display: inline-block;
  position: relative;
  padding-bottom: 4px;
  transition: 0.3s ease-in-out;
}

.link-social-media > img {
  display: block;
  width: 24px;
  height: 24px;
}

.link-social-media:hover {
  transform: translateY(-4px);
}

.link-social-media::before {
  width: 0;
  height: 100%;
  content: ' ';
  position: absolute;
  bottom: 0;
  left: 0;
  transition: width 0.2s ease-out;
}

.link-social-media:hover::before {
  width: 100%;
  border-bottom: 2px var(--custom-pink) solid;
}

@media (max-width: 640px) {
  .footer-divider {
    width: 100%;
  }

  .footer-bottom {
    flex-direction: column;
    align-items: flex-end;
  }
}
</style>
