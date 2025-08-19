<script setup>
import { ref, onMounted, onUnmounted } from "vue"

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  imageSrc: {
    type: String,
    required: true,
  },
  imageAlt: {
    type: String,
    default: "",
  },
})

const emit = defineEmits(["close"])

const handleEscape = (event) => {
  if (event.key === "Escape") {
    emit("close")
  }
}

const handleBackdropClick = (event) => {
  if (event.target === event.currentTarget) {
    emit("close")
  }
}

onMounted(() => {
  document.addEventListener("keydown", handleEscape)
  if (props.isOpen) {
    document.body.style.overflow = "hidden"
  }
})

onUnmounted(() => {
  document.removeEventListener("keydown", handleEscape)
  document.body.style.overflow = ""
})

// Watch for isOpen changes
import { watch } from "vue"
watch(
  () => props.isOpen,
  (newValue) => {
    if (newValue) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
  }
)
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="isOpen"
        class="image-modal-overlay"
        @click="handleBackdropClick"
      >
        <div class="image-modal-content">
          <button
            class="modal-close"
            @click="$emit('close')"
            aria-label="Close modal"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          <img :src="imageSrc" :alt="imageAlt" class="modal-image" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.image-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 20px;
}

.image-modal-content {
  position: relative;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
}

.modal-close {
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: white;
  transition: all 0.2s ease;
  backdrop-filter: blur(4px);
}

.modal-close:hover {
  background: rgba(255, 255, 255, 0.2);
  transform: scale(1.1);
}

/* Modal transitions */
.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}

.modal-enter-from {
  opacity: 0;
  transform: scale(0.9);
}

.modal-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .image-modal-overlay {
    padding: 10px;
  }

  .modal-close {
    top: 10px;
    right: 10px;
    width: 30px;
    height: 30px;
  }
}
</style>
