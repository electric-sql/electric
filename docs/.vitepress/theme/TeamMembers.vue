<script setup>
  const props = defineProps(['items'])
</script>

<style scoped>
  .team-members {
    display: grid;
    grid-template-columns: 33% 33% 33%;
    gap: 24px;
  }
  @media (max-width: 549px) {
    .team-members {
      grid-template-columns: 100%;
    }
  }
  .team-member {
    margin: 12px 0;
    display: flex;
    flex-direction: column;
    justify-content: stretch;
  }
  .team-member .profile-image img {
    border-radius: 3px;
    width: 100%;
    max-width: 225px;
  }
  .team-member h3 {
    margin: 12px 0 6px;
  }
  .team-member h4 {
    margin: 6px 0 4px;
  }
  .team-member p {
    margin: 4px 0 12px;
    color: var(--vp-c-text-2);
    font-size: 15px;
    line-height: 26px;
    flex-grow: 1;
  }
  .team-member small {
    display: flex;
    flex-direction: row;
    align-items: center;
    margin-bottom: 4px;
  }
  .team-member .flag {
    width: 20px;
    margin-right: 0.5rem;
  }
  .team-member .profile-icon-container {
    position: relative;
    display: block;
    width: 20px;
    text-align: left;
    margin-right: 0.5rem;
  }
  .team-member .profile-icon {
    color: var(--vp-c-text-1);
    width: 20px;
    position: relative;
    display: block;
  }
</style>

<template>
  <div class="team-members">
    <div v-for="item in items"
        :id="item.slug"
        :key="item.slug"
        class="team-member">
      <div class="profile-image">
        <a :href="item.profile_uri" class="no-visual">
          <img :src="item.image" />
        </a>
      </div>
      <div class="team-member-body mt-3">
        <a :href="item.profile_uri" class="no-visual">
          <h3>
            {{ item.name }}
          </h3>
          <h4>
            {{ item.job_title }}
          </h4>
          <p>
            {{ item.short_bio }}
          </p>
        </a>
        <a :href="item.profile_uri" class="no-visual">
          <small>
            <img class="flag"
                :src="('/img/flags/' + item.flag + '.svg')"
            />
            <span>
              {{ item.location }}, {{ item.country }}
            </span>
          </small>
          <small>
            <span class="profile-icon-container">
              <span :class="('profile-icon vpi-' + item.profile_icon)" />
            </span>
            {{ item.profile_display_uri }}
          </small>
        </a>
      </div>
    </div>
  </div>
</template>