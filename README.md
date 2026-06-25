# Scraper de Jurisprudencia

Solución robusta y escalable para la extracción automatizada de datos jurisprudenciales, desarrollada en TypeScript bajo el paradigma de **extracción mediante requests HTTP puros**, garantizando alta eficiencia y cumplimiento estricto de las restricciones de no automatización de navegadores.

---

## 🚀 Arquitectura

El sistema ha sido diseñado para interactuar directamente con el ciclo de vida de los servicios JSF (JavaServer Faces) mediante:

* **HttpClient personalizado:** Implementa reintentos con *Backoff Exponencial* para mitigar errores 429 (Rate Limiting).
* **Parser de DOM (Cheerio):** Extracción eficiente y de bajo consumo de recursos sin sobrecarga de renderizado.
* **Persistencia Multi-formato:** Exportación automática a JSON para consumo de datos y CSV para análisis estadístico.

---

## 📋 Requisitos Previos

- **Node.js**: v18 o superior.
- **Gestor de paquetes**: `npm`.
- **Conexión**: VPN requerida para el portal..

---

## ⚙️ Instalación

1. Clonar el repositorio:
```bash
   git clone [https://github.com/Jorgeotero1998/Scraper.git](https://github.com/Jorgeotero1998/Scraper.git)
   cd Scraper
