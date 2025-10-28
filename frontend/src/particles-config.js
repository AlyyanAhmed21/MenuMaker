const particlesConfig = {
  fullScreen: {
    enable: true,
    zIndex: -1
  },
  particles: {
    number: {
      value: 10
    },
    color: {
      value: ["#00FF00", "#0000FF"] // Green and Blue waves
    },
    shape: {
      type: "circle"
    },
    opacity: {
      value: 0.5
    },
    size: {
      value: 100,
      random: {
        enable: true,
        minimumValue: 50
      }
    },
    move: {
      enable: true,
      speed: 2,
      direction: "top",
      outModes: {
        default: "out",
        top: "destroy",
        bottom: "none"
      }
    }
  },
  interactivity: {
    detectsOn: "canvas",
    events: {
      resize: true
    }
  },
  detectRetina: true,
  emitters: {
    direction: "top",
    position: {
      x: 50,
      y: 120
    },
    rate: {
      delay: 0.2,
      quantity: 2
    },
    size: {
      width: 100,
      height: 0
    }
  }
};
export default particlesConfig;