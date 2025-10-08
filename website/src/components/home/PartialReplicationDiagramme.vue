<script setup>
import Card from "./Card.vue"
</script>

<template>
  <div class="container">
    <div class="element node">
      <Card>
        <div class="whole-data-model">
          <img src="/img/home/shapes/whole-data-model.svg" />
        </div>
      </Card>
      <div class="node-label">Your whole data&nbsp;model</div>
    </div>
    <div class="element link-and-label partial-replication">
      <span class="label-text">
        Partial<br />
        replication
      </span>
    </div>
    <div class="element node">
      <Card>
        <div class="selected-data">
          <img src="/img/home/shapes/shape.svg" />
        </div>
      </Card>
      <div class="node-label">
        Just the relevant&nbsp;data&nbsp;&nbsp;&nbsp;
      </div>
    </div>
    <div class="element link-and-label fan-out">
      <span class="label-text"> Fan-out &nbsp; </span>
    </div>
    <div class="element node clients">
      <Card>
        <div class="client">
          <img src="/img/home/shapes/shape.svg" />
          <div class="client-label">Client</div>
        </div>
      </Card>
      <Card>
        <div class="client">
          <img src="/img/home/shapes/shape.svg" />
          <div class="client-label">Client</div>
        </div>
      </Card>
      <Card>
        <div class="client">
          <img src="/img/home/shapes/shape.svg" />
          <div class="client-label">Client</div>
        </div>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.container {
  display: flex;
  flex-direction: row;

  justify-content: stretch;
  align-items: center;

  margin: -10px 0px 40px;

  --font-size: 14px;
}
.node {
  flex-shrink: 1;
}
.node {
  width: 200px;
  position: relative;
  display: block;
}
.node :deep(.card) {
  /*    margin: 0;*/
}
.clients :deep(.card) {
  margin-bottom: 14px;
}
.clients a:last-child :deep(.card) {
  margin-bottom: 0px;
}
.node-label {
  padding: 14px 7px;
  text-align: center;

  color: var(--vp-c-text-3);
  font-weight: 500;
  font-size: var(--font-size);

  display: block;
  position: absolute;
  width: 100%;

  line-height: 1.3;
}
.whole-data-model img {
  margin: 0 auto;
}
.link-and-label {
  flex-grow: 2;

  color: var(--vp-c-text-3);
  font-weight: 500;
  font-size: var(--font-size);

  width: 150px;
  text-align: center;
}
.partial-replication {
  background-image: url(/img/home/link.svg);
  background-position: center center;
  background-size: 100%;
  background-repeat: no-repeat;

  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.label-text {
  padding: 2px 8px;
  background: rgba(27, 27, 31, 0.5);

  position: relative;
  display: block;
  text-align: center;
  line-height: 1.3;
}
.fan-out {
  background-image: url(/img/home/link-with-fanout.svg);
  background-position: center center;
  background-size: 100%;
  background-repeat: no-repeat;

  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.selected-data {
  padding-right: 5px;
}
.selected-data img {
  margin: 0 auto;
  width: 42px;
}
.client {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;

  margin: -15px 0;
}
.client img {
  width: 24px;
  margin-right: 18px;
}
.client-label {
  color: var(--vp-c-text-3);
  font-weight: 500;
  font-size: var(--font-size);
  margin-right: 18px;
}

@media (max-width: 1099px) {
  .fan-out {
    background-image: url(/img/home/link-with-fanout.md.svg);
  }
}
@media (max-width: 982px) {
  .container {
    --font-size: 13.5px;
  }
}
@media (max-width: 959px) {
  .container {
    margin: 40px 0px;
  }
}
@media (max-width: 922px) {
  .container {
    margin-bottom: 50px;
  }
}
@media (max-width: 767px) {
  .fan-out {
    background-image: url(/img/home/link-with-fanout.sm.svg);
  }
}
@media (min-width: 640px) and (max-width: 707px) {
  .container {
    margin: 30px 0px;

    --font-size: 13px;
  }
  .node {
    width: 160px;
  }
  .clients :deep(.card) {
    margin-bottom: 10px;
  }
  .client {
    margin: -13px 0;
  }
  .client img {
    width: 20px;
    margin-right: 16px;
  }
  .client-label {
    margin-right: 0px;
  }
  .selected-data img {
    /*      margin: -4px auto;*/
    /*      width: 50px;*/
  }
  .whole-data-model {
    position: relative;
    display: block;
    margin: -15%;
    width: 130%;
  }
  .whole-data-model img {
    min-width: 50px;
  }
}
@media (max-width: 639px) {
  .container {
    flex-direction: column;
    margin: 40px 0px 20px;
  }
  .node {
    width: 240px;
  }
  .node :deep(.card) {
    padding-top: 0px;
    padding-bottom: 40px;
  }
  .node.clients :deep(.card) {
    padding-top: 0px;
    padding-bottom: 0px;
  }
  .node-label {
    margin-top: -50px;
  }
  .link-and-label {
    flex-grow: 0;
  }
  .partial-replication,
  .fan-out {
    min-height: 90px;
    height: 90px;
  }
  .partial-replication {
    width: 240px;

    background-image: url(/img/home/link.xs.svg);
    background-size: 100% 100%;
  }
  .fan-out {
    width: 180px;

    background-image: url(/img/home/link-with-fanout.xs.svg);
    background-size: 100% 100%;
  }
  .partial-replication .label-text,
  .fan-out .label-text {
  }
  .partial-replication .label-text br {
    display: none;
  }
  .clients {
    display: flex;
    flex-direction: row;
    gap: 12px;
    align-self: flex-start;
    justify-content: center;
    width: 100%;
  }
  .client {
    flex-direction: column;

    margin: -9px 0;
    height: 80px;
  }
  .client img {
    width: 24px;
    margin: 0 0 16px 0;
  }
  .client-label {
    color: var(--vp-c-text-3);
    font-weight: 500;
    font-size: var(--font-size);
    margin-right: 0px;
    margin-bottom: -10px;
  }
}
@media (max-width: 518px) {
  .node :deep(.card) {
    padding-top: 5px;
    padding-bottom: 40px;
  }
  .node.clients :deep(.card) {
    padding-top: 5px;
    padding-bottom: 10px;
  }
}
</style>
