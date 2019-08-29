// Set up
var express  = require('express');
var app      = express();
var mongoose = require('mongoose');
var moment   = require('moment');
var logger = require('morgan');
var bodyParser = require('body-parser');
var cors = require('cors');
var svgCaptcha = require('svg-captcha');
var CryptoJS = require("crypto-js");

var whitelist = ['https://stark-caverns-59860.herokuapp.com','http://localhost:8100',
    'http://cibernetica.inmetro.gov.br']

var CAPTCHA_KEY = process.env.SECRET_KEY;

// Used to create IDs for newly added people
var nextAvailableID = 0;

// Appended to candidate ID to comput verification digit
var YEAR_OF_SIGNUP = "2019";

console.log("Database connection: " + process.env.MONGODB_URI);

var corsOptions = {
    origin: function (origin, callback) {
        if (whitelist.indexOf(origin) !== -1) {
            callback(null, true)
        } else {
            callback(new Error('Acesso proibido pelo CORS: '+ origin))
        }
    }
}

var options = {
    //server: {socketOptions: {keepAlive: 1, connectTimeoutMS: 30000}},
    useMongoClient: true
};

var localPort = process.env.PORT || 8080;

// Configuration
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, options);

mongoose.connection.on("error", function(err) {
    console.log("Could not connect to MongoDb!");
    console.log(err);
    process.exit();
});


app.use(bodyParser.urlencoded({ extended: false })); // Parses urlencoded bodies
app.use(bodyParser.json()); // Send JSON responses
app.use(logger('combined')); // Log requests to API using morgan
app.use(cors());

// Models
var Room = mongoose.model('Room', {
    nome_completo:  String,
    data_nasc:      String,
    data_criado:    Date,
    data_ult_modif: Date,
    rg_identidade:  String,
    cpf:	    String,
    sexo:	    String,
    email:	    String,
    cidade:	    String,
    cep:	    String,
    telefone:	    String,
    escola_publica: String,
    deficiencia:    String,
    cotista:        String,
    ppi:            String,  // nao/pre/par/ind
    renda:          String,  // acima/abaixo
    modo_pagam:     String,  // gru/isencao
    doc_entregue:   String   // sim/nao
    
});


// ----------------------------------------------
// Calcula o dígito em Módulo 10 do número dado.
// Os valores de entrada e saída são string.
// ----------------------------------------------
function CalculaDigitoMod10(Dado)
{
/*--
Banco Itau usa Mod10 para agencia/ conta bancaria

Exemplo: Agência 0155 Conta 50566-2
 +---+---+---+---+---+---+---+---+---+   +---+
 | 0 | 1 | 5 | 5 | 5 | 0 | 5 | 6 | 6 | - | 2 |
 +---+---+---+---+---+---+---+---+---+   +---+
    |   |   |   |   |   |   |   |   |
   x2  x1  x2  x1  x2  x1  x2  x1  x2
    |   |   |   |   |   |   |   |   | (soma digitos)
   =0  =1 =10  =5 =10  =0 =10  =6 =12 ("12" = 1+2 = 3)
    +---+---+---+---+---+---+---+---+-> = 18
  (18 / 10) = 1, resto 8 => DV = (10 - 8) = 2
--*/
    var i;
    var mult = 2;
    var soma = 0;
    var s = "";


    Dado = YEAR_OF_SIGNUP + Dado;
    
    for (i=Dado.length-1; i>=0; i--)
    {
	s = (mult * parseInt(Dado.charAt(i))) + s;
	if (--mult<1)
	{
	    mult = 2;
	}
    }
    for (i=0; i<s.length; i++)
    {
	soma = soma + parseInt(s.charAt(i));
    }
    soma = soma % 10;
    if (soma != 0)
    {
	soma = 10 - soma;
    }
    return soma.toString();
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getLastFourDigits(cpf) {
    // remove dash and dots
    var response = cpf.replace(/\-/g, '');
    response = response.replace(/\./g, '');

    // get the last four...
    response = response.substr(response.length-4);

    return response;
}

function pad(num_str, size) {
    // pad zeroes up to 'size' digits. Ex: pad(99,4) -> '0099'
    return ('0000000000' + num_str).substr(-size);
}

function trimGroupAndDv(id) {
    var response = id.replace(/\-/g, '');
    response = response.replace(/\./g, '');

    // trim signup group (cotas) info (first digit)
    response = response.substring(1, response.length);

    // trim DV (last digit)
    response = response.substring(0, response.length - 1);
    
    return response;
}

function getLastID() {
    var result = 0;
    
    Room.findOne({}, {}, { sort: { 'data_criado' : -1 } }, (err, user) => {
        if (err) {
            // handle error
            result =  0;
        }

        if (user) {
            // this is user last inserted
	    var last_id = trimGroupAndDv(user.rg_identidade);
	    last_id = getLastFourDigits(last_id);
            console.log("Last ID: " + last_id);

	    result =  Number(last_id);
        } else{
            console.log("No user found. Empty db ?.");
            result = 0;
	}
    });

}

function getHighDigit(cotista, ppi, renda) {
    var digit = 9;
    if (cotista && cotista === 'nao') {
	// cotista defined and not a cotista
	digit = 5;
    } else if (cotista) {
	// it is a cotista candidate
	if (renda && renda === 'abaixo') {
	    if (ppi && ppi !== 'nao') {
		digit = 1; 
	    } else if (ppi) {
		digit = 2;
	    }
	} else if (renda) {
	    // renda = acima
	    if (ppi && ppi !== 'nao') {
		digit = 3; 
	    } else if (ppi) {
		digit = 4;
	    }
	}
    }
    return digit;
}

//Room.remove({}, function(res){
//    console.log("removed records");
//});

Room.count({}, function(err, count){
    console.log("Existing candidates: " + count);

});

// Routes

app.get('/api/captcha', function (req, res) {
    var captcha = svgCaptcha.create();

    // Encrypt
    var ciphertext = CryptoJS.AES.encrypt(captcha.text, CAPTCHA_KEY).toString();

    var data ={
        text: ciphertext,
        data: captcha.data
    }
    //res.captcha = captcha.text;
    res.status(200).json(data);
});

//app.post('/api/person', function(req, res) {
//
//     Room.find({ cpf: req.body.cpf }, function(err, rooms){
//         if(err){
//             res.send(err);
//         } else {
//             res.json(rooms);
//         }
//     });
// });

app.post('/api/login', function(req, res, next) {

    /* check if email is defined first! */
    const email_info = req.body.email;
    const senha_info = req.body.senha;

    if (!email_info) {
        const error = new Error('Credencial incompleta...')
        error.httpStatusCode = 400
        return next(error)
    }

    Room.find({ email: email_info }, (err,users) => {
        if (err) {
            // handle error
            console.log("Problema no servidor: tente de novo mais tarde...");
            err.httpStatusCode = 500
            return next(err)
        }

        if (users) {
	    var found = false;
	    users.forEach( (user) => {
		// a user by this email exists...
		senhaCalculada = getLastFourDigits(user.cpf)
		digest = CryptoJS.HmacSHA256(senhaCalculada, process.env.SECRET_KEY)
                    .toString(CryptoJS.enc.Hex);
		console.log("Senha calculada: " + senhaCalculada);
		console.log(digest);

		if (senha_info === digest) {
		    found = true;
                    console.log("Acesso ok para: " + req.body.email);
                    res.status(200).json(user);
		}
	    });

	    if (!found) {
                const error = new Error('Acesso negado!')
                console.log("Acesso negado para: " + req.body.email);
                error.httpStatusCode = 401
                return next(error)
	    }

        } else {
            const error = new Error('Usuário inexistente!')
            error.httpStatusCode = 404
            return next(error)
        }
    });
});


app.post('/api/rooms/insert', cors(corsOptions), function(req, res, next) {

    /* check if CPF is defined first! */
    const cpf_info = req.body.cpf;
    var client_addr = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    Room.findOne({}, {}, { sort: { 'data_criado' : -1 } }, (err, user) => {
        if (err) {
            // handle error
            console.log("Problema no servidor: tente de novo mais tarde...");
            err.httpStatusCode = 500
            return next(err)
        }

        if (user) {
            // this is user last inserted
	    var last_id = trimGroupAndDv(user.rg_identidade);
	    last_id = getLastFourDigits(last_id);
            console.log("Last ID: " + last_id);

	    nextAvailableID =  Number(last_id);
	    
        } else{
	    
            console.log("No user found. Empty db ?.");
            nextAvailableID = 0;
	}
    });

    console.log("Insert request from: " + client_addr);
    console.log("            next ID: " + nextAvailableID);

    if (!cpf_info) {
        const error = new Error('Faltando CPF no registro...')
        error.httpStatusCode = 400
        return next(error)
    }

    Room.findOne({ cpf: cpf_info }, (err,user) => {
        if (err) {
            // handle error
            console.log("Problema no servidor: tente de novo mais tarde...");
            err.httpStatusCode = 500
            return next(err)
        }

        if (user) {
            // a user by this CPF exists already...
            console.log("CPF " + req.body.cpf + " existente...");
	    let err = new Error(`${req.ip} CPF existente.`);
	    // Sets error message, includes the requester's ip address!
	    err.statusCode = 409;
	    next(err);

        } else {
            // proceed with creating user...
            console.log("Inserting: " + req.body.cpf );

	    // what group candidate belongs to?
	    var group = getHighDigit(req.body.cotista,
				     req.body.ppi,
				     req.body.renda);
	    
	    // Assign an ID to candidate
	    var nextID_num = nextAvailableID + 1;
	    nextAvailableID = nextAvailableID + 1;
	    var nextID = pad(nextID_num.toString(), 4);
            console.log("nextID1: " + nextID );
	    nextID = group.toString() + nextID;
            console.log("nextID2: " + nextID );
	    var dv = CalculaDigitoMod10(nextID);
	    nextID = nextID + "-" + dv;
            console.log("dv: " + dv );


            var newPerson = new Room({
                nome_completo:  req.body.nome_completo,
                data_nasc:      req.body.data_nasc,
                data_criado:    moment().format(),
                // rg_identidade:  req.body.rg_identidade,
                rg_identidade:  nextID,
                cpf:	        req.body.cpf,
                sexo:	        req.body.sexo,
                email:	        req.body.email,
                cidade:	        req.body.cidade,
                cep:	        req.body.cep,
                telefone:	req.body.telefone,
                deficiencia:    req.body.deficiencia,
                escola_publica: req.body.escola_publica,
                cotista:        req.body.cotista,       // sim/nao
                renda:          req.body.renda,         // acima/abaixo
		ppi:            req.body.ppi,           // nao/pre/par/ind
		modo_pagam:     req.body.modo_pagam,    // gru/isencao
		doc_entregue:   req.body.doc_entregue   // sim/nao
            });

	    
            newPerson.save(function(err, doc){
                if (err) {
                    console.log("Server Insert Error: " + err);
                    res.send(err);
                }

                console.log("Created person: " + doc.nome_completo);
                console.log("           cpf: " + doc.cpf);
                console.log("         email: " + doc.email);
                console.log("     matricula: " + doc.rg_identidade);
                res.json(doc);
            });
        }
    });
});

app.put('/api/rooms/update', cors(corsOptions), function(req, res, next) {

    var client_addr = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    console.log("Update request from: " + client_addr);


    /* check if CPF is defined first! */
    const cpf_info = req.body.cpf;

    if (!cpf_info) {
        const error = new Error('Faltando CPF no registro...')
        error.httpStatusCode = 400
        return next(error)
    }

    var updatePerson = {
        nome_completo:  req.body.nome_completo,
        data_nasc:      req.body.data_nasc,
        data_ult_modif: moment().format(),
        rg_identidade:  req.body.rg_identidade,
        cpf:	        req.body.cpf,
        sexo:	        req.body.sexo,
        email:	        req.body.email,
        cidade:	        req.body.cidade,
        cep:	        req.body.cep,
        telefone:	req.body.telefone,
        deficiencia:    req.body.deficiencia,
        escola_publica: req.body.escola_publica,
        cotista:        req.body.cotista,       // sim/nao
        renda:          req.body.renda,         // acima/abaixo
	ppi:            req.body.ppi,           // nao/pre/par/ind
	modo_pagam:     req.body.modo_pagam,    // gru/isencao
	doc_entregue:   req.body.doc_entregue   // sim/nao
    };

    var query = { cpf: cpf_info };
    var options = { new: true };

    Room.findOneAndUpdate(query, updatePerson, options,(err,user) => {
        if (err) {
            // handle error
            console.log("Problema para atualizar no servidor");
            console.log(err);

            res.status(statusCode >= 100 && statusCode < 600 ? err.code : 500);
            // err.httpStatusCode = 412
            // return next(err)
        }

        if (user) {
            // the user who goes by this CPF was updated...
            console.log("Registro com CPF " + req.body.cpf + " atualizado...");
            res.json(user);
        }
    });
});

app.use((err, req, res, next) => {
    // log the error...
    console.log("app.use() error:");
    console.log(err.message);
    if (!err.statusCode) err.statusCode = 500;
    // If err has no specified error code, set error code to 'Internal Server Error (500)'
    res.status(err.statusCode).send(err.message);
    // All HTTP requests must have a response, so let's send back an error with its status code and message
})

// listen
app.listen(localPort);
console.log("App listening on port " + localPort);
