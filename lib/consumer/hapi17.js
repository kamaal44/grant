
var urlib = require('url')
var qs = require('qs')

var config = require('../config')
var oauth1 = require('../flow/oauth1')
var oauth2 = require('../flow/oauth2')
var response = require('../response')


module.exports = function (_config) {
  var app = {}

  function register (server, options) {
    app.config = config.init(Object.keys(options).length ? options : _config)

    server.route({
      method: ['GET', 'POST'],
      path: '/connect/{provider}/{override?}',
      handler: async (req, res) => {
        if (!(req.session || req.yar)) {
          throw new Error('Grant: register session plugin first')
        }

        var session = {
          provider: req.params.provider
        }
        if (req.params.override) {
          session.override = req.params.override
        }
        if (req.method === 'get' && Object.keys(req.query || {}).length) {
          var query = qs.parse(urlib.parse(req.url, false).query) // #2985
          session.dynamic = query
        }
        if (req.method === 'post' && Object.keys(req.payload || {}).length) {
          var payload = qs.parse(req.payload) // #2985
          session.dynamic = payload
        }
        ;(req.session || req.yar).set('grant', session)

        return connect(req, res)
      }
    })

    async function connect (req, res) {
      var session = (req.session || req.yar).get('grant')
      var provider = config.provider(app.config, session)

      var transport = (data) => {
        if (!provider.callback) {
          return res.response(qs.stringify(data))
        }
        else if (!provider.transport || provider.transport === 'querystring') {
          return res.redirect(`${provider.callback}?${qs.stringify(data)}`)
        }
        else if (provider.transport === 'session') {
          session.response = data
          ;(req.session || req.yar).set('grant', session)
          return res.redirect(provider.callback)
        }
      }

      if (/^1$/.test(provider.oauth)) {
        try {
          var {body} = await oauth1.request(provider)
          session.request = body
          var url = await oauth1.authorize(provider, body)
          return res.redirect(url)
        }
        catch (err) {
          return transport(err)
        }
      }

      else if (/^2$/.test(provider.oauth)) {
        try {
          session.state = provider.state
          var url = await oauth2.authorize(provider)
          return res.redirect(url)
        }
        catch (err) {
          return transport(err)
        }
      }

      else {
        return transport({error: 'Grant: missing or misconfigured provider'})
      }
    }

    server.route({
      method: 'GET',
      path: '/connect/{provider}/callback',
      handler: async (req, res) => {
        var session = (req.session || req.yar).get('grant')
        var provider = config.provider(app.config, session)
        var query = qs.parse(urlib.parse(req.url, false).query) // #2985

        var transport = (data) => {
          if (!provider.callback) {
            return res.response(qs.stringify(data))
          }
          else if (!provider.transport || provider.transport === 'querystring') {
            return res.redirect(`${provider.callback}?${qs.stringify(data)}`)
          }
          else if (provider.transport === 'session') {
            session.response = data
            ;(req.session || req.yar).set('grant', session)
            return res.redirect(provider.callback)
          }
        }

        if (/^1$/.test(provider.oauth)) {
          try {
            var {body} = await oauth1.access(provider, session.request, query)
            return transport(response(provider, body))
          }
          catch (err) {
            return transport(err)
          }
        }

        else if (/^2$/.test(provider.oauth)) {
          try {
            var {body} = await oauth2.access(provider, query, session)
            return transport(response(provider, body))
          }
          catch (err) {
            return transport(err)
          }
        }

        else {
          return transport({error: 'Grant: missing session or misconfigured provider'})
        }
      }
    })
  }

  app.pkg = require('../../package.json')

  app.register = register
  return app
}