<script setup>
  import Card from './Card.vue'
</script>

<template>
  <div class="container">
    <div class="element node">
      <Card>
        <div class="whole-data-model">
          <img src="/img/home/shapes/whole-data-model.svg" />
        </div>
      </Card>
      <div class="node-label">
        Your whole data&nbsp;model
      </div>
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
        Just the relevant&nbsp;data
      </div>
    </div>
    <div class="element link-and-label fan-out">
      <span class="label-text">
        Fan-out &nbsp;&nbsp;
      </span>
    </div>
    <div class="element node">
      <Card>
        <div class="client">
          <img src="/img/home/shapes/shape.svg" />
          <div class="client-label">
            Client
          </div>
        </div>
      </Card>
      <br />
      <Card>
        <div class="client">
          <img src="/img/home/shapes/shape.svg" />
          <div class="client-label">
            Client
          </div>
        </div>
      </Card>
      <br />
      <Card>
        <div class="client">
          <img src="/img/home/shapes/shape.svg" />
          <div class="client-label">
            Client
          </div>
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

    margin: -20px 0px 30px;
  }
  .node {
    flex-shrink: 1;
  }
  .node {
    width: 200px;
    position: relative;
    display: block;
  }
  .node-label {
    padding: 14px 7px;
    text-align: center;

    color: var(--vp-c-text-3);
    font-weight: 500;
    font-size: 14px;

    display: block;
    position: absolute;
    width: 100%;
  }
  .whole-data-model img {
    margin: 0 auto;
  }
  .link-and-label {
    flex-grow: 2;

    color: var(--vp-c-text-3);
    font-weight: 500;
    font-size: 14px;

    width: 200px;
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
  .label-text  {
    padding: 2px 8px;
    background: rgba(27, 27, 31, 0.5);

    position: relative;
    display: block;
    text-align: center;
    line-height: 1.2;
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

    margin: -14px 0;
  }
  .client img {
    width: 24px;
    margin-right: 18px;
  }
  .client-label {
    color: var(--vp-c-text-3);
    font-weight: 500;
    font-size: 14px;
    margin-right: 18px;
  }
</style>