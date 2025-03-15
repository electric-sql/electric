<template>
  <div class="container">
    <div class="element node">
      <div class="card">
        <div class="whole-data-model">
          <img src="/img/home/shapes/whole-data-model.svg" />
        </div>
      </div>
      <div class="node-label">
        Your whole data model
      </div>
    </div>
    <div class="element link-and-label">
      Partial replication
    </div>
    <div class="element node">
      <div class="card">
        <div class="selected-data">
          <img src="/img/home/shapes/shape.svg" />
        </div>
      </div>
      <div class="node-label">
        Just the relevant data
      </div>
    </div>
    <div class="element link-and-label">
      Fan-out
    </div>
    <div class="element node">
      <div class="card client">
        <img src="/img/home/shapes/shape.svg" />
        <div class="client-label">
          Client
        </div>
      </div>
      <div class="card client">
        <img src="/img/home/shapes/shape.svg" />
        <div class="client-label">
          Client
        </div>
      </div>
      <div class="card client">
        <img src="/img/home/shapes/shape.svg" />
        <div class="client-label">
          Client
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .container {
    display: flex;
    flex-direction: row;
  }
  .link-and-label {
    flex-grow: 1
  }
</style>