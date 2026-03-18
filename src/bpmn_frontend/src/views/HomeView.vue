<template>
  <div style="display: flex; flex-direction: row; height: 100vh">
    <div class="chat-container">
      <ChatInterface
        @bpmn-xml-received="handleBpmnXml"
        @bpmn-json-received="setBpmnJson"
        @lanes-received="setLanes"
        @download="handleDownload"
        :isDownloadReady="!!bpmnXml"
        :process="process"
        :lanes="lanes"
      />
    </div>
    <div
      id="canvas"
      class="canvas-container"
      @dragover.prevent
      @drop="handleDrop"
    ></div>
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="3000">
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>

<script>
import BpmnModeler from 'bpmn-js/lib/Modeler';
import ChatInterface from '../components/ChatInterface.vue';
import { bpmnAssistantUrl, bpmnLayoutServerUrl } from '../config';
import { getApiKeys } from '../utils/apiKeys';
// import initialDiagram from "../assets/initialDiagram.js";
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';

export default {
  name: 'App',
  components: {
    ChatInterface,
  },
  data() {
    return {
      bpmnXml: '',
      process: null, // Process in JSON format
      lanes: null, // Lane definitions
      bpmnViewer: null,
      snackbar: {
        show: false,
        text: '',
        color: 'success',
      },
    };
  },
  mounted() {
    this.bpmnViewer = new BpmnModeler({
      container: '#canvas',
    });

    // this.bpmnViewer
    //   .importXML(initialDiagram)
    //   .then((result) => {
    //     const { warnings } = result;
    //     console.log("BPMN diagram imported successfully", warnings);
    //     this.bpmnViewer.get("canvas").zoom("fit-viewport");
    //   })
    //   .catch((err) => {
    //     console.error("Failed to import BPMN diagram:", err);
    //   });
  },
  beforeUnmount() {
    if (this.bpmnViewer) {
      this.bpmnViewer.destroy();
    }
  },
  methods: {
    showSnackbar(text, color = 'success') {
      this.snackbar.text = text;
      this.snackbar.color = color;
      this.snackbar.show = true;
    },
    async handleDrop(event) {
      event.preventDefault(); // Prevent the browser from default file handling
      if (event.dataTransfer.items) {
        for (let i = 0; i < event.dataTransfer.items.length; i++) {
          if (event.dataTransfer.items[i].kind === 'file') {
            const file = event.dataTransfer.items[i].getAsFile();

            if (file.name.endsWith('.bpmn')) {
              const reader = new FileReader();
              reader.onload = async (e) => {
                const xmlContent = e.target.result;
                try {
                  await this.bpmnViewer.importXML(xmlContent);
                  this.bpmnViewer.get('canvas').zoom('fit-viewport');
                  console.log('BPMN diagram loaded successfully');
                  this.bpmnXml = xmlContent;
                  await this.createBpmnJson();
                } catch (err) {
                  console.error('Failed to import BPMN diagram:', err);
                }
              };
              reader.readAsText(file);
            }
          }
        }
      }
    },
    async createBpmnJson() {
      try {
        const apiKeys = getApiKeys();
        const response = await fetch(`${bpmnAssistantUrl}/bpmn_to_json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bpmn_xml: this.bpmnXml, api_keys: apiKeys }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();
        this.process = data.process;
        this.lanes = data.lanes || null;
        console.log('BPMN JSON created successfully:', this.process);
        this.showSnackbar('BPMN successfully uploaded', 'success');
      } catch (error) {
        console.error('Error creating BPMN JSON:', error);
        this.showSnackbar(
          'There was a problem while loading the BPMN file',
          'error'
        );
      }
    },
    async handleBpmnXml(bpmnXmlValue) {
      if (bpmnXmlValue === '') {
        if (this.bpmnViewer) {
          this.bpmnViewer.destroy();
        }

        this.bpmnViewer = new BpmnModeler({
          container: '#canvas',
        });
        return;
      }

      try {
        // Auto-layout of the BPMN diagram
        const layoutedXml = await this.processDiagram(bpmnXmlValue);
        if (!layoutedXml) {
          throw new Error('Failed to layout the BPMN diagram');
        }
        this.bpmnXml = layoutedXml;
        if (this.bpmnViewer) {
          this.bpmnViewer
            .importXML(layoutedXml)
            .then((result) => {
              const { warnings } = result;
              console.log('BPMN diagram imported successfully', warnings);
              this.bpmnViewer.get('canvas').zoom('fit-viewport');
            })
            .catch((err) => {
              console.error('Failed to import BPMN diagram:', err);
            });
        }
      } catch (error) {
        console.error('Error handling BPMN XML:', error);
      }
    },
    async processDiagram(bpmnDiagram) {
      try {
        const response = await fetch(`${bpmnLayoutServerUrl}/process-bpmn`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ bpmnXml: bpmnDiagram }),
        });

        if (!response.ok) {
          throw new Error('Network response was not ok');
        }

        const { layoutedXml } = await response.json();

        console.log(layoutedXml);

        return layoutedXml;
      } catch (error) {
        console.error('Failed to process the diagram:', error);
      }
    },
    async handleDownload(format) {
      switch (format) {
        case 'bpmn':
          await this.downloadBpmnFile();
          break;
        case 'svg':
          await this.downloadSvg();
          break;
        case 'png':
          await this.downloadPng();
          break;
        case 'pdf':
          await this.downloadPdf();
          break;
        default:
          await this.downloadBpmnFile();
      }
    },
    async downloadBpmnFile() {
      const { xml } = await this.bpmnViewer.saveXML();
      const blob = new Blob([xml], { type: 'text/xml' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'diagram.bpmn';
      a.click();
      window.URL.revokeObjectURL(url);
    },
    async downloadSvg() {
      const { svg } = await this.bpmnViewer.saveSVG();
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'diagram.svg';
      a.click();
      window.URL.revokeObjectURL(url);
    },
    async downloadPng() {
      const { svg } = await this.bpmnViewer.saveSVG();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      return new Promise((resolve) => {
        img.onload = () => {
          canvas.width = img.width * 2;
          canvas.height = img.height * 2;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          canvas.toBlob((blob) => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'diagram.png';
            a.click();
            window.URL.revokeObjectURL(url);
            resolve();
          }, 'image/png');
        };

        const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        img.src = URL.createObjectURL(svgBlob);
      });
    },
    async downloadPdf() {
      const { svg } = await this.bpmnViewer.saveSVG();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      return new Promise((resolve) => {
        img.onload = async () => {
          canvas.width = img.width * 2;
          canvas.height = img.height * 2;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          const pngDataUrl = canvas.toDataURL('image/png');
          const { jsPDF } = await import('jspdf');

          const isLandscape = canvas.width > canvas.height;
          const pdf = new jsPDF({
            orientation: isLandscape ? 'landscape' : 'portrait',
            unit: 'px',
            format: [canvas.width, canvas.height],
          });

          pdf.addImage(pngDataUrl, 'PNG', 0, 0, canvas.width, canvas.height);
          pdf.save('diagram.pdf');
          resolve();
        };

        const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        img.src = URL.createObjectURL(svgBlob);
      });
    },
    setBpmnJson(value) {
      this.process = value;
    },
    setLanes(value) {
      this.lanes = value;
    },
  },
};
</script>

<style>
#canvas {
  margin: 10px;
}

.chat-container {
  flex: 3;
}

.canvas-container {
  flex: 4;
  border: 2px solid gray;
}

@media (min-width: 1800px) {
  .chat-container {
    flex: 2;
  }
  .canvas-container {
    flex: 5;
  }
}
</style>
