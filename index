const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { GoogleGenAI } = require('@google/genai');
const qrcode = require('qrcode-terminal');

const ID_PLANILHA = "1Dlw54YOcyDhd_32qyVdjCWFvHRmCbTTyK5e9Re9SVs"; 
const ID_DOCS = "1O_669rGMid1xbe7wTpxZkQBgrMs2TRzJGbJUJNJA6Fc";

const GEMINI_KEY = process.env.GEMINI_API_KEY; 
const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

// Aqui criamos o cérebro do François para ele lembrar da conversa com cada cliente
const memoriaClientes = {};

async function conectarWhatsapp() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if(qr) {
            console.log("=== ESCANEIE ESTE QR CODE NO SEU WHATSAPP ===");
            qrcode.generate(qr, { small: true });
        }
        if(connection === 'close') {
            console.log("Conexão fechada. Tentando reconectar...");
            conectarWhatsapp();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && msg.message) {
            const textoCliente = msg.message.conversation || msg.message.extendedTextMessage?.text;
            
            // Pegamos o número do WhatsApp do cliente (Ex: 5511999999999)
            const numeroWhatsApp = msg.key.remoteJid.replace('@s.whatsapp.net', ''); 

            if (!textoCliente) return;

            // Cria uma memória para o cliente se for a primeira mensagem do dia
            if (!memoriaClientes[numeroWhatsApp]) {
                memoriaClientes[numeroWhatsApp] = [];
            }

            // Adiciona a mensagem do cliente na memória
            memoriaClientes[numeroWhatsApp].push(`Cliente: ${textoCliente}`);

            // Mantém apenas as últimas 10 mensagens para o François não ficar confuso
            if (memoriaClientes[numeroWhatsApp].length > 10) {
                memoriaClientes[numeroWhatsApp].shift();
            }

            try {
                const resDocs = await fetch(`https://docs.google.com/document/d/${ID_DOCS}/export?format=txt`);
                const regrasNegocio = await resDocs.text();

                const resSheets = await fetch(`https://docs.google.com/spreadsheets/d/${ID_PLANILHA}/export?format=csv`);
                const dadosPlanilha = await resSheets.text();
                
                // Pega o histórico da conversa
                const historicoChat = memoriaClientes[numeroWhatsApp].join('\n');
                
                // O SUPER PROMPT: Aqui damos a vida e a personalidade ao François
                const promptCompleto = `
                Você é François, o atendente virtual do Nany's Coffee Break. Você age como um garçom e concierge de alto nível, acolhedor e humanizado. 
                Sua missão é dar um atendimento sem atritos, sem parecer um robô de botões.
                
                REGRAS DO NEGÓCIO:
                ${regrasNegocio}
                
                DADOS DOS CLIENTES E ESTOQUE (Planilha):
                ${dadosPlanilha}
                
                NÚMERO DO WHATSAPP DESTE CLIENTE: ${numeroWhatsApp}
                
                INSTRUÇÕES ESPECÍFICAS DE ATENDIMENTO:
                1. Verifique nos DADOS DOS CLIENTES se o número ${numeroWhatsApp} já existe.
                2. SE EXISTIR: Trate-o pelo nome, seja caloroso e pergunte como pode ajudar hoje.
                3. SE NÃO EXISTIR: Assuma que é um cliente novo. Dê as boas-vindas e converse de forma fluida para coletar o CPF, Nome e Email. Peça um dado por vez, de forma natural, como se estivesse conversando balcão. Nunca peça senha, o número do WhatsApp já é a identificação dele!
                
                HISTÓRICO RECENTE DESTA CONVERSA:
                ${historicoChat}
                
                Responda agora ao cliente (apenas a fala do François, sem colocar "François:" no início):
                `;
                
                const response = await ai.models.generateContent({
                    model: 'gemini-1.5-flash',
                    contents: promptCompleto,
                });

                const respostaIA = response.text;

                // Adiciona a resposta do François na memória para ele lembrar depois
                memoriaClientes[numeroWhatsApp].push(`François: ${respostaIA}`);

                await sock.sendMessage(msg.key.remoteJid, { text: respostaIA });

            } catch (err) {
                console.error("Erro ao processar mensagem:", err);
            }
        }
    });
}

conectarWhatsapp();
