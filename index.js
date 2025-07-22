const express = require('express');
const mysql = require('mysql2');
const axios = require('axios');
const cron = require('node-cron');
const cors = require('cors');
const { Worker } = require('worker_threads');
const path = require('path');
require('dotenv').config({ path: './config.env' });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configuración de la base de datos
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
};

// Configuración de APIs
const API_CONFIG = {
    TECNYTTESOLUCIONES: {
        baseUrl: 'https://crmwp.tecnytte.com/api/v1/send-text',
        token: process.env.TECNYTTESOLUCIONES_TOKEN,
        instance_id: process.env.TECNYTTESOLUCIONES_INSTANCE
    },
    TECNYTTEGPS: {
        baseUrl: 'https://crmwp.tecnytte.com/api/v1/send-text',
        token: process.env.TECNYTTEGPS_TOKEN,
        instance_id: process.env.TECNYTTEGPS_INSTANCE
    },
    TECNYTTESIMULACIONES: {
        baseUrl: 'https://crmwp.tecnytte.com/api/v1/send-text',
        token: process.env.TECNYTTESIMULACIONES_TOKEN,
        instance_id: process.env.TECNYTTESIMULACIONES_INSTANCE
    }
};

// Sistema de logs clasificados
class Logger {
    constructor() {
        this.logs = {
            COBRANZA: [],
            AUTORUTA_PASTTIME: [],
            AUTORUTA_REALTIME: [],
            REPLICA: [],
            SYSTEM: []
        };
        this.maxLogs = 1000; // Máximo 1000 logs por categoría
    }

    addLog(category, message, data = {}) {
        // Si la categoría no existe, la creamos
        if (!this.logs[category]) {
            this.logs[category] = [];
        }

        const logEntry = {
            timestamp: new Date().toISOString(),
            message,
            data
        };

        this.logs[category].push(logEntry);
        
        // Mantener solo los últimos maxLogs
        if (this.logs[category].length > this.maxLogs) {
            this.logs[category] = this.logs[category].slice(-this.maxLogs);
        }

        // También mostrar en consola
        console.log(`[${category}] ${logEntry.timestamp} - ${message}`, data);
    }

    getLogs(category = null) {
        if (category) {
            return this.logs[category] || [];
        }
        return this.logs;
    }

    clearLogs(category = null) {
        if (category) {
            this.logs[category] = [];
        } else {
            Object.keys(this.logs).forEach(key => {
                this.logs[key] = [];
            });
        }
    }
}

const logger = new Logger();

// Función para crear conexión a la base de datos
function createConnection() {
    return mysql.createConnection(dbConfig);
}

// Función para calcular cantidad de puntos
function calcularCantidadPuntos(cadenaPuntos) {
    const puntosArray = cadenaPuntos.split(',');
    return puntosArray.length / 2;
}

// Función para formatear hora
function formatearHora(fechaHora) {
    function agregarCeros(numero) {
        return numero < 10 ? '0' + numero : numero;
    }

    const year = fechaHora.getFullYear();
    const month = agregarCeros(fechaHora.getMonth() + 1);
    const day = agregarCeros(fechaHora.getDate());
    const hours = agregarCeros(fechaHora.getHours());
    const minutes = agregarCeros(fechaHora.getMinutes());
    const seconds = agregarCeros(fechaHora.getSeconds());

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// Función para calcular distancia entre dos puntos
function calcularDistanciaEnMetros(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Función para calcular velocidad
function calcularVelocidad(distanciaMetros, tiempoSegundos) {
    const velocidadKmh = (distanciaMetros / tiempoSegundos) * 3.6;
    return Math.min(Math.round(velocidadKmh), 100);
}

// Función para enviar datos de posición
async function enviarDatosPosicion(fechaHoraInicial, fechaHoraFinal, cantidadPuntos, puntos, imei, tipoSimulacion) {
    const tiempoTotal = fechaHoraFinal - fechaHoraInicial;
    const intervaloTiempo = tiempoTotal / cantidadPuntos;
    
    logger.addLog(tipoSimulacion === 'REALTIME' ? 'AUTORUTA_REALTIME' : 'AUTORUTA_PASTTIME', 
        `Iniciando simulación ${tipoSimulacion} para IMEI: ${imei}`, {
            cantidadPuntos,
            intervaloTiempo: intervaloTiempo / 60000 + ' minutos'
        });

    const puntosArray = puntos.split(',');
    const puntosLatLong = [];
    for (let i = 0; i < puntosArray.length; i += 2) {
        puntosLatLong.push({
            latitud: puntosArray[i],
            longitud: puntosArray[i + 1]
        });
    }

    let contadorPuntos = 0;
    const intervaloParada = Math.floor(Math.random() * 11) + 30;
    let tiempoActual = fechaHoraInicial.getTime();
    let tiempoAnterior = tiempoActual;
    let latitudAnterior = null;
    let longitudAnterior = null;
    
    for (let i = 0; i < puntosLatLong.length; i++) {
        contadorPuntos++;
        
        const fechaActualTime = new Date(tiempoActual);
        const fechaActual = formatearHora(fechaActualTime);
        
        let speed = 0;
        if (latitudAnterior !== null && longitudAnterior !== null) {
            const distancia = calcularDistanciaEnMetros(
                parseFloat(latitudAnterior), 
                parseFloat(longitudAnterior),
                parseFloat(puntosLatLong[i].latitud), 
                parseFloat(puntosLatLong[i].longitud)
            );
            const tiempoTranscurrido = (tiempoActual - tiempoAnterior) / 1000;
            if (tiempoTranscurrido > 0) {
                speed = calcularVelocidad(distancia, tiempoTranscurrido);
            }
        }
        
        const url = `${process.env.TECNYTTE_TRACKER_URL}/api/api_loc.php?imei=${imei}&lat=${puntosLatLong[i].latitud}&lng=${puntosLatLong[i].longitud}&altitude=100&angle=45&speed=${speed}&loc_valid=1&dt_tracker=${fechaActual}&dt_server=${fechaActual}&params=ignition=1|sos=0|`;

        try {
            const response = await axios.get(url);
            logger.addLog(tipoSimulacion === 'REALTIME' ? 'AUTORUTA_REALTIME' : 'AUTORUTA_PASTTIME', 
                `Punto enviado exitosamente`, {
                    imei,
                    punto: i + 1,
                    total: puntosLatLong.length,
                    latitud: puntosLatLong[i].latitud,
                    longitud: puntosLatLong[i].longitud,
                    velocidad: speed,
                    fecha: fechaActual
                });
        } catch (error) {
            logger.addLog(tipoSimulacion === 'REALTIME' ? 'AUTORUTA_REALTIME' : 'AUTORUTA_PASTTIME', 
                `Error al enviar punto`, {
                    imei,
                    punto: i + 1,
                    error: error.message
                });
        }
        
        // Simulación de paradas
        if (contadorPuntos >= intervaloParada && i < puntosLatLong.length - 1) {
            contadorPuntos = 0;
            const nuevoIntervaloParada = Math.floor(Math.random() * 5) + 8;
            const tiempoDisponible = intervaloTiempo * 0.7;
            
            if (tiempoDisponible > 61000) {
                const tiempoMinimoPorPunto = 61000;
                const cantidadPuntos = Math.min(Math.floor(tiempoDisponible / tiempoMinimoPorPunto), 2);
                
                if (cantidadPuntos >= 1) {
                    await enviarDatosPausa(imei, puntosLatLong[i].latitud, puntosLatLong[i].longitud, fechaActual, cantidadPuntos, tiempoDisponible, tipoSimulacion);
                }
            }
        }
        
        // Esperar según el tipo de simulación
        if (tipoSimulacion === "REALTIME") {
            await new Promise(resolve => setTimeout(resolve, intervaloTiempo));
        } else {
            await new Promise(resolve => setTimeout(resolve, 50000));
        }
        
        tiempoAnterior = tiempoActual;
        latitudAnterior = puntosLatLong[i].latitud;
        longitudAnterior = puntosLatLong[i].longitud;
        tiempoActual += intervaloTiempo;
    }
}

// Función para enviar datos de pausa
async function enviarDatosPausa(imei, latitud, longitud, fechaBase, cantidadPuntos, intervaloDisponible, tipoSimulacion) {
    if (cantidadPuntos < 1 || cantidadPuntos > 2) {
        logger.addLog(tipoSimulacion === 'REALTIME' ? 'AUTORUTA_REALTIME' : 'AUTORUTA_PASTTIME', 
            'Parada cancelada - cantidad de puntos inválida', { cantidadPuntos });
        return;
    }
    
    const tiempoMinimoPorPunto = 61000;
    const tiempoNecesario = tiempoMinimoPorPunto * cantidadPuntos;
    
    if (intervaloDisponible < tiempoNecesario) {
        logger.addLog(tipoSimulacion === 'REALTIME' ? 'AUTORUTA_REALTIME' : 'AUTORUTA_PASTTIME', 
            'Parada cancelada - tiempo insuficiente', { 
                intervaloDisponible: intervaloDisponible/1000 + 's',
                tiempoNecesario: tiempoNecesario/1000 + 's'
            });
        return;
    }
    
    logger.addLog(tipoSimulacion === 'REALTIME' ? 'AUTORUTA_REALTIME' : 'AUTORUTA_PASTTIME', 
        `Iniciando parada con ${cantidadPuntos} punto(s)`, {
            imei,
            latitud,
            longitud,
            cantidadPuntos
        });
    
    const fechaBaseObj = new Date(fechaBase.replace(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/, '$1/$2/$3 $4:$5:$6'));
    fechaBaseObj.setTime(fechaBaseObj.getTime() + 1000);
    const fechaInicial = formatearHora(fechaBaseObj);

    const urlInicial = `${process.env.TECNYTTE_TRACKER_URL}/api/api_loc.php?imei=${imei}&lat=${latitud}&lng=${longitud}&altitude=100&angle=0&speed=0&loc_valid=1&dt_tracker=${fechaInicial}&dt_server=${fechaInicial}&params=ignition=0|sos=0|`;

    try {
        const responseInicial = await axios.get(urlInicial);
        logger.addLog(tipoSimulacion === 'REALTIME' ? 'AUTORUTA_REALTIME' : 'AUTORUTA_PASTTIME', 
            'Punto inicial de parada enviado', { imei, fecha: fechaInicial });
    } catch (error) {
        logger.addLog(tipoSimulacion === 'REALTIME' ? 'AUTORUTA_REALTIME' : 'AUTORUTA_PASTTIME', 
            'Error al enviar punto inicial de parada', { imei, error: error.message });
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const incrementoTiempo = tiempoMinimoPorPunto;
    
    for (let i = 0; i < cantidadPuntos; i++) {
        fechaBaseObj.setTime(fechaBaseObj.getTime() + incrementoTiempo);
        const fechaPausa = formatearHora(fechaBaseObj);
        
        const url = `${process.env.TECNYTTE_TRACKER_URL}/api/api_loc.php?imei=${imei}&lat=${latitud}&lng=${longitud}&altitude=100&angle=0&speed=0&loc_valid=1&dt_tracker=${fechaPausa}&dt_server=${fechaPausa}&params=ignition=0|sos=0|`;

        try {
            const response = await axios.get(url);
            logger.addLog(tipoSimulacion === 'REALTIME' ? 'AUTORUTA_REALTIME' : 'AUTORUTA_PASTTIME', 
                `Punto adicional de parada enviado`, { 
                    imei, 
                    punto: i + 1, 
                    fecha: fechaPausa 
                });
        } catch (error) {
            logger.addLog(tipoSimulacion === 'REALTIME' ? 'AUTORUTA_REALTIME' : 'AUTORUTA_PASTTIME', 
                'Error al enviar punto adicional de parada', { imei, error: error.message });
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

// Función para mapear eventos
function mapEvent(alarmValue) {
    const eventMap = {
        powerCut: "pwrcut",
        lowBattery: "lowbat",
        sos: "sos",
        lowPower: "lowdc",
        door: "door",
        powerOff: "gpscut",
        hardBraking: "hbrake",
        hardCornering: "hcorn",
        hardAcceleration: "haccel"
    };
    return eventMap[alarmValue] || '';
}

// Función para formatear parámetros
function formatParams(params) {
    return Object.entries(params)
        .map(([key, value]) => `${key}:${typeof value === 'boolean' ? (value ? 1 : 0) : value}`)
        .join(',');
}

// Función para crear cuerpo de datos
function createDataBody(imeiSimu, item, params, event) {
    return {
        imei: imeiSimu,
        lat: item.lat,
        lng: item.lng,
        altitude: item.altitude,
        angle: item.angle,
        protocol: 'SIMU',
        speed: item.speed,
        dt_server: item.dt_server,
        dt_tracker: item.dt_tracker,
        loc_valid: 1,
        params: params,
        event: event
    };
}

// Función para obtener datos de la base de datos
async function getDataFromDB(query, params = []) {
    const connection = createConnection();
    try {
        const [results] = await connection.promise().query(query, params);
        return results;
    } finally {
        connection.end();
    }
}

// Función para obtener simulaciones de autoruta
async function getAutoRutaSimulations() {
    try {
        const results = await getDataFromDB("SELECT * FROM dt_auto_ruta WHERE estado = '1'");
        logger.addLog('AUTORUTA_PASTTIME', `Simulaciones autoruta obtenidas: ${results.length}`);
        return results;
    } catch (error) {
        logger.addLog('AUTORUTA_PASTTIME', 'Error al obtener simulaciones autoruta', { error: error.message });
        throw error;
    }
}

// Función para obtener simulaciones de réplica
async function getReplicaSimulations() {
    try {
        const results = await getDataFromDB("SELECT * FROM dt_auto_ruta WHERE estado_replica = '1' AND tipoSimulacion LIKE 'REPLICA'");
        logger.addLog('REPLICA', `Simulaciones réplica obtenidas: ${results.length}`);
        return results;
    } catch (error) {
        logger.addLog('REPLICA', 'Error al obtener simulaciones réplica', { error: error.message });
        throw error;
    }
}

// Función para obtener clientes deudores
async function getDeudaClientes() {
    try {
        const results = await getDataFromDB("SELECT * FROM bot_clientes WHERE TRIM(estado) = 'DEUDA'");
        logger.addLog('COBRANZA', `Clientes deudores obtenidos: ${results.length}`);
        return results;
    } catch (error) {
        logger.addLog('COBRANZA', 'Error al obtener clientes deudores', { error: error.message });
        throw error;
    }
}

// Función para obtener clientes programados
async function getClientesProgramados() {
    try {
        const results = await getDataFromDB("SELECT * FROM bot_clientes WHERE tipo_cliente = 'PROGRAMADO'");
        logger.addLog('COBRANZA', `Clientes programados obtenidos: ${results.length}`);
        return results;
    } catch (error) {
        logger.addLog('COBRANZA', 'Error al obtener clientes programados', { error: error.message });
        throw error;
    }
}

// Función para enviar mensaje WhatsApp
async function enviarMensaje(cliente, index) {
    const empresaConfig = API_CONFIG[cliente.empresa.trim()];
    
    if (!empresaConfig) {
        logger.addLog('COBRANZA', 'Empresa no configurada', {
            cliente: cliente.nombre,
            numero: cliente.numero,
            empresa: cliente.empresa
        });
        return;
    }

    try {
        const url = empresaConfig.baseUrl;
        const params = {
            token: empresaConfig.token,
            instance_id: empresaConfig.instance_id,
            jid: `${cliente.numero.trim().replace(/\+/g, '')}@s.whatsapp.net`,
            msg: cliente.mensaje
        };

        const response = await axios.get(url, { params });
        
        logger.addLog('COBRANZA', 'Mensaje enviado exitosamente', {
            index,
            cliente: cliente.nombre,
            numero: cliente.numero,
            empresa: cliente.empresa,
            response: response.data
        });

        return response.data;
    } catch (error) {
        logger.addLog('COBRANZA', 'Error al enviar mensaje', {
            index,
            cliente: cliente.nombre,
            numero: cliente.numero,
            empresa: cliente.empresa,
            error: error.message
        });
        throw error;
    }
}

// Función para obtener datos por IMEI
async function getData(imeis) {
    try {
        const response = await axios.get(`${process.env.TECNYTTE_TRACKER_URL}/api/api.php?api=server&ver=1.0&key=${process.env.API_KEY}&cmd=GET_OBJECTS_ONLINE_AND_NOT_ONLINE_DATA,${imeis}`);
        return response.data;
    } catch (error) {
        logger.addLog('REPLICA', 'Error al obtener datos del IMEI', { error: error.message });
        throw error;
    }
}

// Función principal de autoruta
async function processAutoRuta() {
    try {
        const listaSimulaciones = await getAutoRutaSimulations();
        logger.addLog('AUTORUTA_PASTTIME', 'Iniciando validación de programaciones autoruta');
        
        for (let i = 0; i < listaSimulaciones.length; i++) {
            const simulacion = listaSimulaciones[i];
            
            try {
                const tipoSimulacion = simulacion.tipoSimulacion;
                
                // Verificar si es una réplica y saltarla
                if (tipoSimulacion === 'REPLICA') {
                    logger.addLog('AUTORUTA_PASTTIME', `Saltando réplica: ${simulacion.id}`, { imei: simulacion.imei });
                    continue;
                }
                
                const fechaLanzamiento = new Date(simulacion.fechaLanzamiento);
                const imei = simulacion.imei;
                const fechaHoraInicial = new Date(simulacion.fechaHoraInicial);
                const fechaHoraFinal = new Date(simulacion.fechaHoraFinal);
                
                // Validar que puntos no esté vacío
                if (!simulacion.puntos || simulacion.puntos.trim() === '') {
                    logger.addLog('AUTORUTA_PASTTIME', `Saltando simulación sin puntos: ${simulacion.id}`, { imei });
                    continue;
                }
                
                // Parsear puntos de forma segura
                let puntos;
                try {
                    const puntosJson = JSON.parse(simulacion.puntos.trim());
                    
                    // Verificar estructura del JSON
                    if (!puntosJson.routes || !Array.isArray(puntosJson.routes) || puntosJson.routes.length === 0) {
                        logger.addLog('AUTORUTA_PASTTIME', `Estructura JSON inválida en simulación: ${simulacion.id}`, { 
                            imei, 
                            puntos: simulacion.puntos.substring(0, 100) + '...' 
                        });
                        continue;
                    }
                    
                    if (!puntosJson.routes[0].points) {
                        logger.addLog('AUTORUTA_PASTTIME', `No se encontraron puntos en routes[0] para simulación: ${simulacion.id}`, { imei });
                        continue;
                    }
                    
                    puntos = puntosJson.routes[0].points;
                } catch (parseError) {
                    logger.addLog('AUTORUTA_PASTTIME', `Error parseando JSON de puntos para simulación: ${simulacion.id}`, { 
                        imei, 
                        error: parseError.message,
                        puntos: simulacion.puntos.substring(0, 100) + '...'
                    });
                    continue;
                }
                
                const cantidadPuntos = calcularCantidadPuntos(puntos);

                const fechaHoraActual = new Date();
                const sonIguales = fechaHoraActual.getFullYear() === fechaLanzamiento.getFullYear() &&
                                fechaHoraActual.getMonth() === fechaLanzamiento.getMonth() &&
                                fechaHoraActual.getDate() === fechaLanzamiento.getDate() &&
                                fechaHoraActual.getHours() === fechaLanzamiento.getHours() &&
                                fechaHoraActual.getMinutes() === fechaLanzamiento.getMinutes();

                if (sonIguales) {
                    logger.addLog('AUTORUTA_PASTTIME', `Iniciando simulación activa: ${simulacion.id}`, {
                        imei,
                        tipoSimulacion,
                        fechaLanzamiento: fechaLanzamiento.toLocaleString()
                    });

                    fechaHoraInicial.setHours(fechaHoraInicial.getHours() + 5);
                    fechaHoraFinal.setHours(fechaHoraFinal.getHours() + 5);

                    const datosHilo = {
                        imei: imei,
                        fechaHoraInicial: fechaHoraInicial,
                        fechaHoraFinal: fechaHoraFinal,
                        cantidadPuntos: cantidadPuntos,
                        puntos: puntos,
                        tipoSimulacion: tipoSimulacion,
                    };

                    const worker = new Worker('./worker.js', { workerData: datosHilo });
                    worker.on('message', message => {
                        logger.addLog('AUTORUTA_PASTTIME', 'Hilo de trabajo terminado', { status: message.status });
                    });
                    worker.on('error', error => {
                        logger.addLog('AUTORUTA_PASTTIME', 'Error en el hilo de trabajo', { error: error.message });
                    });
                    worker.on('exit', code => {
                        if (code !== 0) {
                            logger.addLog('AUTORUTA_PASTTIME', 'Hilo terminado con código de error', { code });
                        }
                    });
                }
            } catch (error) {
                logger.addLog('AUTORUTA_PASTTIME', `Error procesando simulación ${simulacion.id}`, { 
                    imei: simulacion.imei, 
                    error: error.message 
                });
                // Continuar con la siguiente simulación en lugar de salir del loop
                continue;
            }
        }
        logger.addLog('AUTORUTA_PASTTIME', 'Validación de programaciones autoruta completada');
    } catch (error) {
        logger.addLog('AUTORUTA_PASTTIME', 'Error en proceso autoruta', { error: error.message });
    }
}

// Función principal de réplica
async function processReplica() {
    try {
        const listaSimulaciones = await getReplicaSimulations();
        
        // Filtrar simulaciones válidas
        const simulacionesValidas = listaSimulaciones.filter(sim => {
            try {
                const fechaHoraActual = new Date();
                const fechaHoraInicial = new Date(sim.fechaHoraInicial);
                const fechaHoraFinal = new Date(sim.fechaHoraFinal);
                
                // Verificar que las fechas sean válidas
                if (isNaN(fechaHoraInicial.getTime()) || isNaN(fechaHoraFinal.getTime())) {
                    logger.addLog('REPLICA', `Fechas inválidas en simulación: ${sim.id}`, { 
                        imei: sim.imei, 
                        fechaHoraInicial: sim.fechaHoraInicial,
                        fechaHoraFinal: sim.fechaHoraFinal
                    });
                    return false;
                }
                
                return fechaHoraActual >= fechaHoraInicial && fechaHoraActual <= fechaHoraFinal;
            } catch (error) {
                logger.addLog('REPLICA', `Error validando fechas de simulación: ${sim.id}`, { 
                    imei: sim.imei, 
                    error: error.message 
                });
                return false;
            }
        });
        
        if (simulacionesValidas.length === 0) {
            logger.addLog('REPLICA', 'No se encontraron simulaciones válidas en el intervalo de tiempo actual');
            return;
        }
        
        const imeisReal = simulacionesValidas
            .map(sim => sim.imei_real)
            .filter(imei => imei && imei.trim() !== '') // Filtrar IMEIs vacíos
            .join(";");

        if (!imeisReal) {
            logger.addLog('REPLICA', 'No se encontraron IMEIs válidos para procesar');
            return;
        }

        const data = await getData(imeisReal);

        for (const simulacion of simulacionesValidas) {
            try {
                const imei = simulacion.imei_real;
                const item = data[imei];

                if (item) {
                    const params = formatParams(item.params);
                    const event = mapEvent(item.params.alarm);
                    const dataBody = createDataBody(simulacion.imei, item, params, event);

                    try {
                        const response = await axios.post(`${process.env.TECNYTTE_TRACKER_URL}/api/api_loc_v2.php`, { imeis: [dataBody] });
                        logger.addLog('REPLICA', 'Datos enviados correctamente', {
                            imei: simulacion.imei,
                            imei_real: imei,
                            response: response.data
                        });
                    } catch (error) {
                        logger.addLog('REPLICA', 'Error al enviar datos', {
                            imei: simulacion.imei,
                            imei_real: imei,
                            error: error.message
                        });
                    }
                } else {
                    logger.addLog('REPLICA', 'No se encontraron datos para IMEI', {
                        imei: simulacion.imei,
                        imei_real: imei
                    });
                }
            } catch (error) {
                logger.addLog('REPLICA', `Error procesando simulación: ${simulacion.id}`, {
                    imei: simulacion.imei,
                    error: error.message
                });
                continue; // Continuar con la siguiente simulación
            }
        }
    } catch (error) {
        logger.addLog('REPLICA', 'Error en proceso réplica', { error: error.message });
    }
}

// Función principal de cobranza
async function processCobranza() {
    try {
        const clientes = await getDeudaClientes();
        logger.addLog('COBRANZA', `Procesando ${clientes.length} clientes deudores`);

        for (let i = 0; i < clientes.length; i++) {
            const cliente = clientes[i];
            try {
                await new Promise(resolve => setTimeout(resolve, parseInt(process.env.MESSAGE_DELAY)));
                await enviarMensaje(cliente, i);
            } catch (error) {
                logger.addLog('COBRANZA', 'Error procesando cliente', {
                    index: i,
                    cliente: cliente.nombre,
                    error: error.message
                });
                continue;
            }
        }
        logger.addLog('COBRANZA', 'Proceso de cobranza completado');
    } catch (error) {
        logger.addLog('COBRANZA', 'Error en proceso de cobranza', { error: error.message });
    }
}

// Función para procesar clientes programados
async function processClientesProgramados() {
    try {
        const clientes = await getClientesProgramados();
        logger.addLog('COBRANZA', `Validando ${clientes.length} clientes programados`);

        for (const cliente of clientes) {
            try {
                // Validar que tenga fecha_hora_envio
                if (!cliente.fecha_hora_envio) {
                    logger.addLog('COBRANZA', `Cliente programado sin fecha de envío: ${cliente.id}`, {
                        cliente: cliente.nombre,
                        numero: cliente.numero
                    });
                    continue;
                }

                const fechaProgramada = new Date(cliente.fecha_hora_envio);
                const fechaActual = new Date();
                
                // Verificar si es la hora y minuto programado
                const esHoraProgramada = fechaActual.getFullYear() === fechaProgramada.getFullYear() &&
                                       fechaActual.getMonth() === fechaProgramada.getMonth() &&
                                       fechaActual.getDate() === fechaProgramada.getDate() &&
                                       fechaActual.getHours() === fechaProgramada.getHours() &&
                                       fechaActual.getMinutes() === fechaProgramada.getMinutes();

                if (esHoraProgramada) {
                    logger.addLog('COBRANZA', `Enviando mensaje programado: ${cliente.id}`, {
                        cliente: cliente.nombre,
                        numero: cliente.numero,
                        fechaProgramada: fechaProgramada.toLocaleString(),
                        repetirCadaDias: cliente.repetir_cada_dias
                    });

                    // Enviar mensaje
                    await enviarMensaje(cliente, 'PROGRAMADO');

                    // Actualizar fecha_hora_envio para la próxima repetición
                    if (cliente.repetir_cada_dias > 0) {
                        const nuevaFecha = new Date(fechaProgramada);
                        nuevaFecha.setDate(nuevaFecha.getDate() + parseInt(cliente.repetir_cada_dias));
                        
                        // Actualizar en la base de datos
                        await actualizarFechaEnvio(cliente.id, nuevaFecha);
                        
                        logger.addLog('COBRANZA', `Fecha actualizada para próxima repetición: ${cliente.id}`, {
                            cliente: cliente.nombre,
                            nuevaFecha: nuevaFecha.toLocaleString(),
                            diasRepeticion: cliente.repetir_cada_dias
                        });
                    } else {
                        logger.addLog('COBRANZA', `Mensaje único enviado, no se repite: ${cliente.id}`, {
                            cliente: cliente.nombre
                        });
                    }
                }
            } catch (error) {
                logger.addLog('COBRANZA', `Error procesando cliente programado: ${cliente.id}`, {
                    cliente: cliente.nombre,
                    error: error.message
                });
                continue;
            }
        }
    } catch (error) {
        logger.addLog('COBRANZA', 'Error en proceso de clientes programados', { error: error.message });
    }
}

// Función para actualizar fecha_hora_envio en la base de datos
async function actualizarFechaEnvio(clienteId, nuevaFecha) {
    try {
        // Usar formatearHora para mantener la zona horaria local
        const fechaFormateada = formatearHora(nuevaFecha);
        await getDataFromDB(
            "UPDATE bot_clientes SET fecha_hora_envio = ? WHERE id = ?",
            [fechaFormateada, clienteId]
        );
        logger.addLog('COBRANZA', `Fecha actualizada en BD: ${clienteId}`, {
            nuevaFecha: fechaFormateada
        });
    } catch (error) {
        logger.addLog('COBRANZA', `Error actualizando fecha en BD: ${clienteId}`, {
            error: error.message
        });
        throw error;
    }
}

// Rutas de la API web
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/logs', (req, res) => {
    const category = req.query.category;
    const logs = logger.getLogs(category);
    res.json(logs);
});

app.get('/api/status', (req, res) => {
    const status = {
        timestamp: new Date().toISOString(),
        services: {
            autoruta: {
                active: true,
                lastRun: new Date().toISOString(),
                interval: process.env.AUTORUTA_INTERVAL
            },
            replica: {
                active: true,
                lastRun: new Date().toISOString(),
                interval: process.env.REPLICA_INTERVAL
            },
            cobranza: {
                active: true,
                schedule: process.env.COBRANZA_SCHEDULE
            }
        },
        logs: {
            COBRANZA: logger.logs.COBRANZA.length,
            AUTORUTA_PASTTIME: logger.logs.AUTORUTA_PASTTIME.length,
            AUTORUTA_REALTIME: logger.logs.AUTORUTA_REALTIME.length,
            REPLICA: logger.logs.REPLICA.length,
            SYSTEM: logger.logs.SYSTEM.length
        }
    };
    res.json(status);
});

app.delete('/api/logs', (req, res) => {
    const category = req.query.category;
    logger.clearLogs(category);
    res.json({ message: 'Logs limpiados exitosamente' });
});

// Iniciar servicios
setInterval(processAutoRuta, parseInt(process.env.AUTORUTA_INTERVAL));
setInterval(processReplica, parseInt(process.env.REPLICA_INTERVAL));

// Programar cobranza
cron.schedule(process.env.COBRANZA_SCHEDULE, () => {
    logger.addLog('COBRANZA', 'Iniciando tarea programada de verificación de deuda');
    processCobranza();
});

// Programar verificación de clientes programados (cada minuto)
setInterval(processClientesProgramados, 60000); // 60000 ms = 1 minuto

// Iniciar servidor
app.listen(PORT, () => {
    logger.addLog('SYSTEM', `Servidor iniciado en puerto ${PORT}`);
    console.log(`Servidor Tecnytte unificado iniciado en puerto ${PORT}`);
    console.log(`Web interface disponible en: http://localhost:${PORT}`);
}); 