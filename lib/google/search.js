import fetch from "#core/fetch";
import { encode as uuleEncode } from "#core/utils/uule";
import { DOMParser } from "linkedom";
import Api from "#core/api";
import ProxyClient from "#core/proxy";
import randomLocation from "random-location";
import { quoteMeta } from "#core/utils";
import Agent from "#core/http/agent";

export default class GoogleSearch {
    #proxy;
    #datasets;
    #maxRetries;
    #num = 100;
    #agent;

    constructor ( { proxy, datasets, maxRetries = 10 } = {} ) {
        this.#proxy = ProxyClient.new( proxy );
        this.#datasets = typeof datasets === "string" ? Api.new( datasets ).unref() : datasets;
        this.#maxRetries = maxRetries;
        this.#agent = new Agent( { "keepAlive": true, "proxy": this.#proxy } );
    }

    // public
    async search ( { keyword, target, maxResults = 100, location, minDistance, maxDistance, proxy, language } ) {
        if ( proxy ) proxy = ProxyClient.new( proxy );

        target = this.#createRegExp( target );

        var coordinates;

        if ( typeof location === "string" ) {
            const geolocation = await this.#datasets.call( "geotargets/get-geotarget", location, { "random_coordinates": true } );

            if ( !geolocation.data?.random_coordinates ) return result( [500, `Unable to get random coordinates for location`] );

            coordinates = geolocation.data.random_coordinates;
        }
        else {
            if ( maxDistance ) {
                coordinates = randomLocation.randomAnnulusPoint( location, minDistance || 0, maxDistance );
            }
            else {
                coordinates = location;
            }
        }

        const uule = uuleEncode( coordinates ),
            results = [];

        var num = this.#num,
            start = 0,
            url = `https://www.google.com/search?q=` + encodeURIComponent( keyword );

        if ( language ) url += "&hl=" + language;

        const agent = proxy
            ? new Agent( {
                "keepAlive": true,
                "proxy": proxy,
            } )
            : this.#agent;

        COLLECT_RESULTS: while ( 1 ) {
            let res, text;

            let _url = url + "&num=" + num;
            if ( start ) _url += "&start=" + start;

            for ( let n = 0; n < this.#maxRetries; n++ ) {
                try {
                    res = await fetch( _url, {
                        agent,
                        "chrome": true,
                        "headers": { "cookie": "UULE=" + uule },
                    } );

                    if ( !res.ok ) throw res;

                    text = await res.text();

                    break;
                }
                catch ( e ) {
                    res = result.catch( e );
                }
            }

            if ( !res.ok ) return res;

            const document = new DOMParser().parseFromString( text, "text/html" );

            const links = document.querySelectorAll( `div[class="g"]` );

            for ( const el of links ) {
                const item = {
                    "position": results.length + 1,
                    "title": el.querySelector( "h3" )?.textContent,
                    "description": el.querySelector( "div.IsZvec" )?.textContent,
                    "url": el.querySelector( "div.yuRUbf > a" )?.getAttribute( "href" ),
                };

                results.push( item );

                if ( target ) {
                    let url;

                    try {
                        url = new URL( item.url );
                        url = url.hostname + url.pathname;
                    }
                    catch ( e ) {}

                    // target found
                    if ( url && target.test( url ) ) return result( 200, item );
                }

                if ( results.length >= maxResults ) break COLLECT_RESULTS;
            }

            const next = document.querySelector( "a#pnnext" );

            if ( !next ) break;

            start += num;

            // url = new URL( next.getAttribute( "href" ), url );
        }

        if ( target ) return result( 200 );
        else return result( 200, results );
    }

    // private
    #createRegExp ( target ) {
        if ( !target ) return;

        if ( target.startsWith( "*." ) ) target = target.substr( 2 );

        target = quoteMeta( target );

        target = "(.*\\.)?" + target;

        if ( target.endsWith( "\\*" ) ) target = target.substr( 0, target.length - 2 ) + ".*";

        if ( !target.includes( "/" ) ) target += "\\/.*";

        target = new RegExp( "^" + target + "$", "i" );

        return target;
    }
}