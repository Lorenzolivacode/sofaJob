import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTerminalHtml } from './terminalHtml';

const STORAGE_KEY = 'relayHost';

export default function App() {
  const [host, setHost] = useState(null);
  const [draft, setDraft] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v) {
        setHost(v);
        setDraft(v);
      }
      setLoaded(true);
    });
  }, []);

  const saveHost = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    await AsyncStorage.setItem(STORAGE_KEY, trimmed);
    setHost(trimmed);
  };

  const changeHost = () => setHost(null);

  if (!loaded) return <View style={styles.container} />;

  if (!host) {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.settingsBox}
        >
          <Text style={styles.label}>Indirizzo del relay (PC)</Text>
          <TextInput
            style={styles.input}
            placeholder="192.168.1.50:4455"
            placeholderTextColor="#777"
            autoCapitalize="none"
            autoCorrect={false}
            value={draft}
            onChangeText={setDraft}
          />
          <TouchableOpacity style={styles.button} onPress={saveHost}>
            <Text style={styles.buttonText}>Connetti</Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
        <StatusBar style="light" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.topBarText}>{host}</Text>
        <TouchableOpacity onPress={changeHost}>
          <Text style={styles.changeLink}>cambia</Text>
        </TouchableOpacity>
      </View>
      <WebView
        originWhitelist={['*']}
        source={{ html: getTerminalHtml(host) }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
      />
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1e1e1e',
  },
  settingsBox: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  label: {
    color: '#ccc',
    marginBottom: 8,
    fontSize: 14,
  },
  input: {
    backgroundColor: '#2a2a2a',
    color: '#eee',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#4caf50',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#252525',
  },
  topBarText: {
    color: '#aaa',
    fontSize: 12,
  },
  changeLink: {
    color: '#4caf50',
    fontSize: 12,
  },
  webview: {
    flex: 1,
    backgroundColor: '#1e1e1e',
  },
});
