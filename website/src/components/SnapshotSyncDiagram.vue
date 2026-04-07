<template>
  <div class="snapshot-sync-diagram">
    <!-- Section 1: Document Stream -->
    <div class="section">
      <div class="section-label">
        Document Stream <span class="sublabel">(append-only log)</span>
      </div>
      <div class="stream-row">
        <div class="stream-cell">0</div>
        <div class="stream-cell">1</div>
        <div class="stream-cell">2</div>
        <div class="stream-ellipsis">...</div>
        <div class="stream-cell">4780</div>
        <div class="stream-cell">4781</div>
        <div class="stream-cell highlight">4782</div>
        <div class="stream-cell">4783</div>
        <div class="stream-cell">4784</div>
        <div class="stream-ellipsis">...</div>
      </div>
    </div>

    <!-- Section 2: Compaction arrow from 4782 down to snapshot -->
    <div class="compaction-section">
      <div class="compaction-connector">
        <div class="compaction-line"></div>
        <div class="compaction-arrow">&#9660;</div>
        <div class="compaction-label">compaction</div>
      </div>
    </div>

    <!-- Section 3: Snapshot box -->
    <div class="snapshot-section">
      <div class="snapshot-box">
        <div class="snapshot-title">Snapshot</div>
        <div class="snapshot-detail">@ offset 4782</div>
        <div class="snapshot-badge">immutable / cacheable</div>
      </div>
    </div>

    <!-- Section 4: Client request flow -->
    <div class="flow-section">
      <div class="flow-title">Client sync flow</div>

      <!-- Step 1: Initial request -->
      <div class="flow-step">
        <div class="step-number">1</div>
        <div class="step-content">
          <div class="step-description">Client requests snapshot</div>
          <div class="step-code">GET ?offset=snapshot</div>
        </div>
        <div class="step-arrow">&#9654;</div>
        <div class="step-result">
          <div class="step-code redirect">307 Redirect</div>
        </div>
      </div>

      <!-- Step 2: Redirect to snapshot -->
      <div class="flow-step">
        <div class="step-number">2</div>
        <div class="step-content">
          <div class="step-description">Redirect resolves to snapshot</div>
          <div class="step-code">&#8594; Snapshot @ offset 4782</div>
        </div>
        <div class="step-arrow">&#9654;</div>
        <div class="step-result">
          <div class="step-response">
            <span class="response-header">next-offset:</span>
            <span class="response-value">4783</span>
          </div>
        </div>
      </div>

      <!-- Step 3: Live subscription -->
      <div class="flow-step">
        <div class="step-number">3</div>
        <div class="step-content">
          <div class="step-description">Client subscribes for live updates</div>
          <div class="step-code">GET ?offset=4783&amp;live=sse</div>
        </div>
        <div class="step-arrow">&#9654;</div>
        <div class="step-result">
          <div class="step-code live">SSE stream &#8594; 4783, 4784, ...</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.snapshot-sync-diagram {
  font-family: var(--vp-font-family-base);
  color: var(--vp-c-text-1);
  padding: 24px 0;
  max-width: 100%;
  overflow-x: auto;
}

/* Section labels */
.section-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin-bottom: 12px;
}
.sublabel {
  font-weight: 400;
  color: var(--vp-c-text-3);
}

/* Stream row */
.stream-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0;
  overflow-x: auto;
  padding-bottom: 4px;
}
.stream-cell {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  height: 36px;
  padding: 0 8px;
  background: var(--vp-c-bg-soft);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-right: none;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-3);
  white-space: nowrap;
}
.stream-cell:last-of-type {
  border-right: 1px solid rgba(255, 255, 255, 0.1);
}
.stream-cell.highlight {
  border: 2px solid var(--durable-streams-color);
  background: rgba(117, 251, 253, 0.08);
  color: var(--durable-streams-color);
  font-weight: 600;
  position: relative;
  z-index: 1;
}
.stream-ellipsis {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 36px;
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  color: var(--vp-c-text-3);
  letter-spacing: 2px;
}

/* Compaction section */
.compaction-section {
  display: flex;
  justify-content: center;
  padding: 0;
  /* Shift to align under the highlighted 4782 cell */
}
.compaction-connector {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
}
.compaction-line {
  width: 2px;
  height: 24px;
  background: var(--durable-streams-color);
  opacity: 0.6;
}
.compaction-arrow {
  color: var(--durable-streams-color);
  font-size: 12px;
  line-height: 1;
  margin-top: -4px;
}
.compaction-label {
  font-size: 11px;
  color: var(--vp-c-text-3);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 2px;
}

/* Snapshot section */
.snapshot-section {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
}
.snapshot-box {
  border: 2px solid var(--durable-streams-color);
  border-radius: 8px;
  padding: 16px 28px;
  text-align: center;
  background: rgba(117, 251, 253, 0.04);
  min-width: 200px;
}
.snapshot-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--durable-streams-color);
  margin-bottom: 4px;
}
.snapshot-detail {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: var(--vp-c-text-1);
  margin-bottom: 8px;
}
.snapshot-badge {
  display: inline-block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vp-c-text-3);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  padding: 2px 10px;
}

/* Flow section */
.flow-section {
  margin-top: 28px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 20px;
}
.flow-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin-bottom: 16px;
}
.flow-step {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.step-number {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--electric-color);
  color: var(--vp-c-bg);
  font-size: 12px;
  font-weight: 700;
}
.step-content {
  flex: 1;
  min-width: 180px;
}
.step-description {
  font-size: 13px;
  color: var(--vp-c-text-3);
  margin-bottom: 4px;
}
.step-code {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
  padding: 4px 10px;
  border-radius: 4px;
  display: inline-block;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.step-code.redirect {
  color: var(--electric-color);
  border-color: rgba(0, 210, 160, 0.3);
}
.step-code.live {
  color: var(--durable-streams-color);
  border-color: rgba(117, 251, 253, 0.3);
}
.step-arrow {
  flex-shrink: 0;
  color: var(--vp-c-text-3);
  font-size: 14px;
}
.step-result {
  flex-shrink: 0;
}
.step-response {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  background: var(--vp-c-bg-soft);
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.response-header {
  color: var(--vp-c-text-3);
}
.response-value {
  color: var(--durable-streams-color);
  font-weight: 600;
}

/* Mobile adjustments */
@media (max-width: 640px) {
  .snapshot-sync-diagram {
    padding: 16px 0;
  }
  .stream-cell {
    min-width: 34px;
    height: 30px;
    padding: 0 5px;
    font-size: 10px;
  }
  .stream-ellipsis {
    min-width: 28px;
    font-size: 12px;
  }
  .snapshot-box {
    padding: 12px 20px;
    min-width: 160px;
  }
  .flow-step {
    gap: 8px;
  }
  .step-content {
    min-width: 140px;
  }
  .step-code {
    font-size: 11px;
    padding: 3px 8px;
  }
  .step-description {
    font-size: 12px;
  }
  .step-response {
    font-size: 11px;
  }
}

@media (max-width: 480px) {
  .flow-step {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding-left: 36px;
    position: relative;
    margin-bottom: 18px;
  }
  .step-number {
    position: absolute;
    left: 0;
    top: 0;
  }
  .step-arrow {
    display: none;
  }
}
</style>
