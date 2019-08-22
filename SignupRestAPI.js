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
    renda:        String
});

/*
 * Generate some test data, if no records exist already
 * MAKE SURE TO REMOVE THIS IN PROD ENVIRONMENT
*/

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

    console.log("Insert request from: " + client_addr);
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

            var newPerson = new Room({
                nome_completo:  req.body.nome_completo,
                data_nasc:      req.body.data_nasc,
                data_criado:    moment().format(),
                rg_identidade:  req.body.rg_identidade,
                cpf:	           req.body.cpf,
                sexo:	   req.body.sexo,
                email:	   req.body.email,
                cidade:	   req.body.cidade,
                cep:	           req.body.cep,
                telefone:	   req.body.telefone,
                deficiencia:    req.body.deficiencia,
                escola_publica: req.body.escola_publica,
                cotista:        req.body.cotista,
                renda:        req.body.renda
            });

            newPerson.save(function(err, doc){
                if (err) {
                    console.log("Server Insert Error: " + err);
                    res.send(err);
                }

                console.log("Created person: " + doc.cpf);
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
        cotista:        req.body.cotista,
        renda:        req.body.renda
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
