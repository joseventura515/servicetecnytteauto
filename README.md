# 🚀 Tecnytte - Servicio Unificado

Servicio unificado que combina las funcionalidades de simulaciones autoruta, réplicas y cobranza de clientes con una interfaz web para monitoreo de logs.

## 📋 Características

- **Simulaciones Autoruta**: Manejo de simulaciones PASTTIME y REALTIME
- **Réplicas**: Sincronización de datos entre IMEIs reales y simulados
- **Cobranza**: Envío automático de mensajes WhatsApp a clientes deudores
- **Web Interface**: Panel de control para monitorear logs clasificados
- **Logs Organizados**: Sistema de logs separados por tipo de servicio

## 🛠️ Instalación

1. **Instalar dependencias**:
```bash
npm install
```

2. **Configurar variables de entorno**:
   - Copiar `config.env` y ajustar las configuraciones según tu entorno
   - Configurar credenciales de base de datos
   - Configurar tokens de WhatsApp API

3. **Iniciar el servicio**:
```bash
npm start
```

## 🌐 Acceso a la Web Interface

Una vez iniciado el servicio, accede a:
```
http://localhost:3000
```

## 📊 Funcionalidades de la Web Interface

### Panel de Estado
- Estado de cada servicio (Autoruta, Réplica, Cobranza)
- Última ejecución de cada servicio
- Contadores de logs por categoría

### Logs Clasificados
- **💬 Cobranza**: Logs de envío de mensajes WhatsApp
- **🔄 Autoruta PastTime**: Logs de simulaciones históricas
- **⚡ Autoruta RealTime**: Logs de simulaciones en tiempo real
- **🔄 Réplica**: Logs de sincronización de datos

### Controles
- Actualizar logs en tiempo real
- Limpiar logs por categoría
- Limpiar todos los logs

## 🔧 Configuración

### Variables de Entorno (config.env)

```env
# Base de Datos
DB_HOST=localhost
DB_USER=gps
DB_PASSWORD=@123@gpsO
DB_NAME=sistema_cobros

# Servidor
PORT=3000
NODE_ENV=production

# APIs
TECNYTTE_TRACKER_URL=https://gps.tecnytte.com
API_KEY=4C992B2947DFF375E4D75337E9EB5AB1
USER_TOKEN=29A51402D29359061D885496BBFD5CC7

# WhatsApp APIs
TECNYTTESOLUCIONES_TOKEN=...
TECNYTTESOLUCIONES_INSTANCE=...
TECNYTTEGPS_TOKEN=...
TECNYTTEGPS_INSTANCE=...
TECNYTTESIMULACIONES_TOKEN=...
TECNYTTESIMULACIONES_INSTANCE=...

# Intervalos
AUTORUTA_INTERVAL=58000
REPLICA_INTERVAL=60000
COBRANZA_SCHEDULE=30 11 * * *
MESSAGE_DELAY=60000
```

## 📁 Estructura del Proyecto

```
├── index.js              # Servicio principal unificado
├── worker.js             # Worker para simulaciones
├── config.env            # Configuración de variables
├── package.json          # Dependencias del proyecto
├── public/
│   └── index.html       # Interfaz web
└── README.md            # Este archivo
```

## 🔄 Servicios Integrados

### 1. Autoruta (PASTTIME/REALTIME)
- Obtiene programaciones de la tabla `dt_auto_ruta`
- Valida fechas de lanzamiento
- Ejecuta simulaciones en hilos separados
- Maneja paradas automáticas

### 2. Réplica
- Sincroniza datos entre IMEIs reales y simulados
- Obtiene datos de la tabla `dt_auto_ruta` con `estado_replica = '1'`
- Envía datos al API de Tecnytte

### 3. Cobranza
- Obtiene clientes deudores de `bot_clientes`
- Envía mensajes WhatsApp automáticamente
- Programado para ejecutarse diariamente a las 11:30 PM

## 📈 Monitoreo

### Logs Disponibles
- **COBRANZA**: Mensajes enviados, errores de envío
- **AUTORUTA_PASTTIME**: Simulaciones históricas, puntos enviados
- **AUTORUTA_REALTIME**: Simulaciones en tiempo real
- **REPLICA**: Sincronización de datos, errores

### API Endpoints
- `GET /api/logs?category=COBRANZA` - Obtener logs por categoría
- `GET /api/status` - Estado del sistema
- `DELETE /api/logs?category=COBRANZA` - Limpiar logs por categoría

## 🚀 Comandos Útiles

```bash
# Iniciar en modo desarrollo
npm run dev

# Iniciar en producción
npm start

# Ver logs en tiempo real
tail -f logs/app.log
```

## 🔍 Troubleshooting

### Problemas Comunes

1. **Error de conexión a base de datos**
   - Verificar credenciales en `config.env`
   - Asegurar que MySQL esté ejecutándose

2. **Errores de API**
   - Verificar tokens de WhatsApp
   - Comprobar conectividad a APIs externas

3. **Logs no aparecen**
   - Verificar que el servicio esté ejecutándose
   - Revisar consola para errores

## 📞 Soporte

Para soporte técnico, contactar al equipo de desarrollo de Tecnytte.

---

**Desarrollado por Tecnytte** 🚀 