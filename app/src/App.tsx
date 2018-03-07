import * as React from 'react';
import * as Nes from 'nes';
import './App.css';
import { ClientSubscribeFlags } from 'nes';

const logo = require('./logo.svg');
const client = new Nes.Client('wss://api.cryptocurrencygraphic.com/ws/');

interface AppProps {}

interface Trade {
    action: String;
    exchange: String;
    unit: Number;
    price: Number;
    sourcePair: String;
    destinationPair: String;
}

interface AppState {
    btc: Trade;
    bch: Trade;
    eth: Trade;
    ltc: Trade;
}

class App extends React.Component<AppProps, AppState> {
  constructor(props: AppProps) {
    super(props);
    this.state = {
      btc: {
          action: '',
          exchange: '',
          unit: 0,
          price: 0,
          sourcePair: '',
          destinationPair: '',
      },
      bch: {
          action: '',
          exchange: '',
          unit: 0,
          price: 0,
          sourcePair: '',
          destinationPair: '',
      },
      eth: {
          action: '',
          exchange: '',
          unit: 0,
          price: 0,
          sourcePair: '',
          destinationPair: '',
      },
      ltc: {
          action: '',
          exchange: '',
          unit: 0,
          price: 0,
          sourcePair: '',
          destinationPair: '',
      },
    };

    const start = async() => {
      await client.connect({});
      client.subscribe('/BTC/USD', (update: Trade, flags: ClientSubscribeFlags) => {
          this.setState({
              btc: update,
          });
      });
      client.subscribe('/BCH/USD', (update: Trade, flags: ClientSubscribeFlags) => {
          this.setState({
              bch: update,
          });
      });
      client.subscribe('/ETH/USD', (update: Trade, flags: ClientSubscribeFlags) => {
          this.setState({
              eth: update,
          });
      });
      client.subscribe('/LTC/USD', (update: Trade, flags: ClientSubscribeFlags) => {
          this.setState({
              ltc: update,
          });
      });
    };

    start();
  }

  render() {
    return (
      <div className="App">
        <header className="App-header">
          <img src={logo} className="App-logo" alt="logo" />
          <h1 className="App-title">Welcome to React</h1>
        </header>
        <p className="App-intro">
          To get started, edit <code>src/App.tsx</code> and save to reload.
        </p>
        <div>
            <h1>{this.state.btc.exchange}</h1>
            <br/>
            {this.state.btc.action.toUpperCase()} {this.state.btc.unit} {this.state.btc.sourcePair} @
            ${this.state.btc.price} {this.state.btc.destinationPair}
        </div>
        <div>
            <h1>{this.state.bch.exchange}</h1>
            <br/>
            {this.state.bch.action.toUpperCase()} {this.state.bch.unit} {this.state.bch.sourcePair} @
            ${this.state.bch.price} {this.state.bch.destinationPair}
        </div>
        <div>
            <h1>{this.state.eth.exchange}</h1>
            <br/>
            {this.state.eth.action.toUpperCase()} {this.state.eth.unit} {this.state.eth.sourcePair} @
            ${this.state.eth.price} {this.state.eth.destinationPair}
        </div>
        <div>
            <h1>{this.state.ltc.exchange}</h1>
            <br/>
            {this.state.ltc.action.toUpperCase()} {this.state.ltc.unit} {this.state.ltc.sourcePair} @
            ${this.state.ltc.price} {this.state.ltc.destinationPair}
        </div>
      </div>
    );
  }
}

export default App;
