<template>
  <div class="entity-overview">
    <svg viewBox="0 0 560 240" class="overview-svg">
      <defs>
        <marker id="ah" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
          <polygon points="0 0, 7 2.5, 0 5" class="ah-fill" />
        </marker>
        <marker id="ah-rev" markerWidth="7" markerHeight="5" refX="0" refY="2.5" orient="auto">
          <polygon points="7 0, 0 2.5, 7 5" class="ah-fill" />
        </marker>
      </defs>

      <!-- ── Wake sources (left) ── -->
      <g v-for="(src, i) in wakes" :key="'w'+i">
        <circle :cx="6" :cy="wakeY(i)" r="4" class="wake-dot" />
        <text :x="14" :y="wakeY(i) + 4" class="wake-label">{{ src }}</text>
        <!-- horizontal line to bus -->
        <line :x1="110" :y1="wakeY(i)" :x2="130" :y2="wakeY(i)" class="conn" />
      </g>
      <!-- vertical bus line -->
      <line x1="130" :y1="wakeY(0)" x2="130" :y2="wakeY(3)" class="conn" />
      <!-- single arrow from bus into handler -->
      <line x1="130" :y1="wakeMid" x2="158" :y2="wakeMid" class="conn" marker-end="url(#ah)" />

      <!-- ── Entity box ── -->
      <rect x="148" y="4" width="404" height="138" rx="7" class="entity-box" />
      <text x="160" y="20" class="entity-label">Entity  /support/ticket-42</text>

      <!-- Handler -->
      <rect x="160" y="30" width="108" height="44" rx="5" class="handler-box" />
      <text x="214" y="47" text-anchor="middle" class="box-label">Handler</text>
      <text x="214" y="63" text-anchor="middle" class="box-sub">ctx + wake</text>

      <!-- Durable Stream -->
      <rect x="296" y="30" width="244" height="52" rx="5" class="inner-box" />
      <text x="418" y="46" text-anchor="middle" class="box-label">Durable Stream</text>
      <rect v-for="(_, i) in events" :key="'e'+i"
            :x="304 + i * 46" y="54" width="38" height="20" rx="3"
            class="stream-event" />
      <text v-for="(ev, i) in events" :key="'el'+i"
            :x="323 + i * 46" y="68" text-anchor="middle"
            class="event-label">{{ ev }}</text>

      <!-- Arrow: handler → stream -->
      <line x1="268" y1="52" x2="296" y2="52" class="conn" marker-end="url(#ah)" />

      <!-- Agent Loop -->
      <rect x="160" y="90" width="108" height="44" rx="5" class="inner-box" />
      <text x="214" y="107" text-anchor="middle" class="box-label">Agent Loop</text>
      <text x="214" y="123" text-anchor="middle" class="box-sub">LLM ↔ tools</text>

      <!-- State -->
      <rect x="296" y="90" width="130" height="44" rx="5" class="inner-box" />
      <text x="361" y="107" text-anchor="middle" class="box-label">State</text>
      <text x="361" y="123" text-anchor="middle" class="box-sub">collections</text>

      <!-- Arrow: handler → agent loop -->
      <line x1="214" y1="74" x2="214" y2="90" class="conn" marker-end="url(#ah)" />

      <!-- Arrow: agent ↔ state (bidirectional) -->
      <line x1="268" y1="112" x2="296" y2="112"
            class="conn" marker-end="url(#ah)" marker-start="url(#ah-rev)" />

      <!-- ── Coordination (below entity) ── -->
      <g v-for="(c, i) in coords" :key="'c'+i">
        <!-- line segment above label -->
        <line :x1="c.cx" y1="142" :x2="c.cx" y2="158" class="conn" />
        <!-- label (no line behind it) -->
        <text :x="c.cx" y="172" text-anchor="middle" class="coord-label">{{ c.label }}</text>
        <!-- line segment below label to child box -->
        <line :x1="c.cx" y1="178" :x2="c.cx" y2="192" class="conn" marker-end="url(#ah)" />
        <!-- child box -->
        <rect :x="c.cx - 44" y="192" width="88" height="34" rx="5" class="child-box" />
        <text :x="c.cx" y="207" text-anchor="middle" class="child-label">{{ c.path }}</text>
        <text :x="c.cx" y="220" text-anchor="middle" class="child-sub">{{ c.id }}</text>
      </g>
    </svg>
  </div>
</template>

<script setup lang="ts">
const wakes = ['message', 'child done', 'state change', 'timeout']
const events = ['run', 'tool', 'text', 'run', 'tool']
const coords = [
  { label: 'spawn', path: '/worker/', id: 'task-1', cx: 218 },
  { label: 'send', path: '/notify/', id: 'abc', cx: 350 },
  { label: 'observe', path: '/order/', id: '99', cx: 482 },
]

const wakeTop = 32
const wakeGap = 24
const wakeMid = wakeTop + (3 * wakeGap) / 2

function wakeY(i: number) {
  return wakeTop + i * wakeGap
}
</script>

<style scoped>
.entity-overview {
  width: 100%;
  margin: 16px 0 24px;
}

.overview-svg {
  width: 100%;
  height: auto;
  display: block;
}

.entity-box {
  fill: var(--ea-surface);
  stroke: var(--ea-divider);
  stroke-width: 1.5;
}

.entity-label {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  fill: var(--ea-text-2);
}

.handler-box {
  fill: var(--ea-surface-alt);
  stroke: var(--vp-c-brand-1);
  stroke-width: 1.5;
}

.inner-box {
  fill: var(--ea-surface-alt);
  stroke: var(--ea-divider);
  stroke-width: 1;
}

.child-box {
  fill: var(--ea-surface);
  stroke: var(--ea-divider);
  stroke-width: 1;
}

.stream-event {
  fill: var(--vp-c-brand-soft);
  stroke: var(--vp-c-brand-1);
  stroke-width: 0.75;
}

.box-label {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 600;
  fill: var(--ea-text-1);
}

.box-sub {
  font-family: var(--vp-font-family-mono);
  font-size: 9.5px;
  fill: var(--ea-text-2);
}

.event-label {
  font-family: var(--vp-font-family-mono);
  font-size: 9px;
  fill: var(--ea-text-2);
}

.wake-dot {
  fill: var(--vp-c-brand-1);
}

.wake-label {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  fill: var(--ea-text-1);
}

.coord-label {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  fill: var(--ea-text-2);
}

.child-label {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  fill: var(--ea-text-1);
}

.child-sub {
  font-family: var(--vp-font-family-mono);
  font-size: 9px;
  fill: var(--ea-text-2);
}

.conn {
  stroke: var(--ea-text-3);
  stroke-width: 1;
  fill: none;
}

.ah-fill {
  fill: var(--ea-text-3);
}
</style>
