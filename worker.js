const axios = require('axios');
const { workerData, parentPort } = require('worker_threads');

function formatearHora(fechaHora){
    function agregarCeros(numero) {
        return numero < 10 ? '0' + numero : numero;
    }

    const year = fechaHora.getFullYear();
    const month = agregarCeros(fechaHora.getMonth() + 1);
    const day = agregarCeros(fechaHora.getDate());
    const hours = agregarCeros(fechaHora.getHours());
    const minutes = agregarCeros(fechaHora.getMinutes());
    const seconds = agregarCeros(fechaHora.getSeconds());

    const fechaFormateada = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    return fechaFormateada;
}

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

function calcularVelocidad(distanciaMetros, tiempoSegundos) {
    const velocidadKmh = (distanciaMetros / tiempoSegundos) * 3.6;
    return Math.min(Math.round(velocidadKmh), 100);
}

async function enviarDatosPausa(imei, latitud, longitud, fechaBase, cantidadPuntos, intervaloDisponible, trackerUrlDestino) {
    if (cantidadPuntos < 1 || cantidadPuntos > 2) {
        console.log('**************PARADA CANCELADA*********************');
        console.log(`Cantidad de puntos inválida: ${cantidadPuntos}`);
        return;
    }
    
    const tiempoMinimoPorPunto = 61000;
    const tiempoNecesario = tiempoMinimoPorPunto * cantidadPuntos;
    
    if (intervaloDisponible < tiempoNecesario) {
        console.log('**************PARADA CANCELADA*********************');
        console.log(`Intervalo disponible (${intervaloDisponible/1000}s) insuficiente para simular ${cantidadPuntos} puntos de parada con mínimo de 61s cada uno`);
        return;
    }
    
    console.log('**************INICIO ENVIANDO PARADA*********************');
    console.log(`SIMULANDO PARADA con ${cantidadPuntos} punto(s) en: Latitud ${latitud}, Longitud ${longitud}`);
    console.log(`Servidor destino: ${trackerUrlDestino}`);
    
    const fechaBaseObj = new Date(fechaBase.replace(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/, '$1/$2/$3 $4:$5:$6'));
    fechaBaseObj.setTime(fechaBaseObj.getTime() + 1000);
    const fechaInicial = formatearHora(fechaBaseObj);

    console.log(`Fecha original: ${fechaBase} -> Fecha inicial de parada: ${fechaInicial}`);

    const urlInicial = `${trackerUrlDestino}/api/api_loc.php?imei=${imei}&lat=${latitud}&lng=${longitud}&altitude=100&angle=0&speed=0&loc_valid=1&dt_tracker=${fechaInicial}&dt_server=${fechaInicial}&params=ignition=0|sos=0|`;

    try {
        const responseInicial = await axios.get(urlInicial);
        console.log(`Respuesta del servidor para punto INICIAL de parada: ${responseInicial.status} - ${responseInicial.statusText}`);
    } catch (error) {
        console.error('Error al enviar datos del punto INICIAL de parada:', error.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const incrementoTiempo = tiempoMinimoPorPunto;
    
    for (let i = 0; i < cantidadPuntos; i++) {
        fechaBaseObj.setTime(fechaBaseObj.getTime() + incrementoTiempo);
        const fechaPausa = formatearHora(fechaBaseObj);
        
        console.log(`Enviando punto adicional de parada ${i+1}/${cantidadPuntos} a las ${fechaPausa} (incremento exacto: 61 segundos)`);
        
        const url = `${trackerUrlDestino}/api/api_loc.php?imei=${imei}&lat=${latitud}&lng=${longitud}&altitude=100&angle=0&speed=0&loc_valid=1&dt_tracker=${fechaPausa}&dt_server=${fechaPausa}&params=ignition=0|sos=0|`;

        try {
            const response = await axios.get(url);
            console.log(`Respuesta del servidor para punto adicional de parada: ${response.status} - ${response.statusText}`);
        } catch (error) {
            console.error('Error al enviar datos de punto adicional de parada:', error.message);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('**************FIN ENVIANDO PARADA*********************');
}

async function enviarDatosPosicion(fechaHoraInicial, fechaHoraFinal, cantidadPuntos, puntos, imei, tipoSimulacion, trackerUrlDestino) {
    const tiempoTotal = fechaHoraFinal - fechaHoraInicial;
    const intervaloTiempo = tiempoTotal / cantidadPuntos;
    console.log("Se va a enviar la data cada: " + intervaloTiempo / 60000 + " Minutos");
    console.log("Servidor destino: " + trackerUrlDestino);

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
        
        console.log('**************INICIO ENVIANDO PUNTO NORMAL*********************');
        console.log(`ENVIADO IMEI: ${imei} Enviando de la FECHA: ${fechaActual}`);
        console.log(`Enviando datos de posición: Latitud ${puntosLatLong[i].latitud}, Longitud ${puntosLatLong[i].longitud}, Velocidad: ${speed} km/h`);
        console.log(`Se está enviando cada: ${intervaloTiempo / 60000} Minutos`);

        const url = `${trackerUrlDestino}/api/api_loc.php?imei=${imei}&lat=${puntosLatLong[i].latitud}&lng=${puntosLatLong[i].longitud}&altitude=100&angle=45&speed=${speed}&loc_valid=1&dt_tracker=${fechaActual}&dt_server=${fechaActual}&params=ignition=1|sos=0|`;

        console.log(url);
        
        try {
            const response = await axios.get(url);
            console.log(`Respuesta del servidor: ${response.status} - ${response.statusText}`);
        } catch (error) {
            console.error('Error al enviar los datos de posición:', error.message);
        }
        
        if (contadorPuntos >= intervaloParada && i < puntosLatLong.length - 1) {
            contadorPuntos = 0;
            const nuevoIntervaloParada = Math.floor(Math.random() * 5) + 8;
            const tiempoDisponible = intervaloTiempo * 0.7;
            
            if (tiempoDisponible > 61000) {
                console.log(`Tiempo disponible para parada: ${tiempoDisponible/1000} segundos (suficiente)`);
                
                const tiempoMinimoPorPunto = 61000;
                const cantidadPuntos = Math.min(Math.floor(tiempoDisponible / tiempoMinimoPorPunto), 2);
                
                console.log(`Calculado ${cantidadPuntos} punto(s) para esta parada`);
                
                if (cantidadPuntos >= 1) {
                    enviarDatosPausa(imei, puntosLatLong[i].latitud, puntosLatLong[i].longitud, fechaActual, cantidadPuntos, tiempoDisponible, trackerUrlDestino);
                }
            } else {
                console.log(`Tiempo disponible para parada: ${tiempoDisponible/1000} segundos (insuficiente, se omite la parada)`);
            }
            
            console.log(`Próxima parada después de ${nuevoIntervaloParada} puntos`);
        }
        
        if (tipoSimulacion === "REALTIME") {
            console.log("TIPO ENVIO: REALTIME");
            await new Promise(resolve => setTimeout(resolve, intervaloTiempo));
        } else {
            console.log("TIPO ENVIO: PASTTIME");
            await new Promise(resolve => setTimeout(resolve, 50000));
        }
        
        console.log('**************FIN ENVIANDO PUNTO NORMAL*********************');
        
        tiempoAnterior = tiempoActual;
        latitudAnterior = puntosLatLong[i].latitud;
        longitudAnterior = puntosLatLong[i].longitud;
        tiempoActual += intervaloTiempo;
    }
}

// Ejecutar la función enviarDatosPosicion() con los datos proporcionados
enviarDatosPosicion(
    workerData.fechaHoraInicial, 
    workerData.fechaHoraFinal, 
    workerData.cantidadPuntos, 
    workerData.puntos, 
    workerData.imei, 
    workerData.tipoSimulacion,
    workerData.trackerUrlDestino || 'https://gps.tecnytte.com'
);

// Informar al hilo principal que el trabajo ha terminado
parentPort.postMessage({ status: 'COMPLETED' }); 